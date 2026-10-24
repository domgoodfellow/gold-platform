import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { connectPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import {
  invoiceStanding,
  issueInvoice,
  listCustomerInvoices,
  listInvoiceLines,
  listPayments,
  recordPayment,
} from '@/lib/domain/billing/invoices';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { claimPortalInvite, createPortalInvite } from '@/lib/domain/portal/portal';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { createPlan, grantPlanProduct } from '@/lib/domain/catalogue/plans';
import { DEFAULT_PORTAL_CONTENT } from '@/lib/domain/portal/composition';
import { portalEditorState, publishPortalDraft, savePortalDraft, submitPortalDraft } from '@/lib/domain/portal/definitions';

/**
 * A customer initiating their own card payment — the external axis's narrowest door yet.
 *
 * Deliberately tested at the RPC layer (`db.rpc('begin_external_card_payment', ...)`) rather
 * than through `requestPortalCardPayment`/`requestCardPayment`: both call `paymentProvider()`,
 * which makes a real HTTPS request to Stripe once configured, and this suite runs with no
 * processor configured and no network call of any kind. Everything this slice actually had to
 * get right — scope derivation, amount integrity, entitlement, account isolation — lives in the
 * function these tests call directly.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const PROVIDER = 'test-processor';

type Business = {
  db: SupabaseClient;
  organizationId: string;
  customerId: string;
  otherCustomerId: string;
  invoiceId: string;
  otherInvoiceId: string;
};

let shop: Business;
let rival: Business;
let staff: SupabaseClient;

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function newBusiness(label: string, options: { cardPayments: boolean }): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Owner',
    timezone: 'America/Toronto',
    currency: 'CAD',
  });
  const orgId = organizationId as string;

  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: orgId, name: 'Callout' });
  const statusId = await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' });
  const priceItemId = await createPriceBookItem(db, {
    organizationId: orgId,
    name: 'Tyre change',
    unit: 'visit',
    unitAmountMinor: 12_000,
  });

  const customerId = await createCustomer(db, { organizationId: orgId, name: `${label} Customer` });
  const otherCustomerId = await createCustomer(db, { organizationId: orgId, name: 'Somebody Else' });

  await setModuleEnabled(db, { organizationId: orgId, key: 'portal', enabled: true });

  if (options.cardPayments) {
    await setModuleEnabled(db, { organizationId: orgId, key: 'card_payments', enabled: true });
    await recordCommercialTerm(staff, {
      organizationId: orgId,
      productKey: 'module:card_payments',
      periodStart: '2026-01-01',
      periodEnd: '9999-12-31',
      priceMinor: 0,
      currency: 'CAD',
    });
    await connectPaymentAccount(db, {
      organizationId: orgId,
      provider: PROVIDER,
      account: { accountId: `acct_${label}` },
    });
  }

  async function invoiceFor(customer: string, title: string): Promise<string> {
    const workItemId = await createWorkItem(db, {
      organizationId: orgId,
      title,
      statusId,
      customerId: customer,
    });
    await addPricedLine(db, { workItemId, priceBookItemId: priceItemId, quantity: 1 });
    return issueInvoice(db, { workItemId, dueAt: null });
  }

  const invoiceId = await invoiceFor(customerId, `${label} job`);
  const otherInvoiceId = await invoiceFor(otherCustomerId, `${label} other job`);

  return { db, organizationId: orgId, customerId, otherCustomerId, invoiceId, otherInvoiceId };
}

/** A customer holding the link the business sent them. */
async function recognised(business: Business, customerId: string): Promise<SupabaseClient> {
  const token = await createPortalInvite(business.db, { customerId });
  const db = anonClient();
  await claimPortalInvite(db, { token });
  return db;
}

type BeginPaymentResult = {
  request_id: string;
  outstanding_minor: number;
  currency: string;
  account_id: string;
};

/** Cast rather than typed against `Database` — every other suite in this file uses the plain
 * `SupabaseClient`, and this repository's generated types don't carry through a wrapper like
 * this one without also carrying the client's own generic (`Db`, unused here on purpose to
 * match the rest of the suite). */
async function begin(
  db: SupabaseClient,
  invoiceId: string,
): Promise<{ data: BeginPaymentResult | null; error: { code: string; message: string } | null }> {
  return db
    .rpc('begin_external_card_payment', { p_invoice_id: invoiceId, p_provider: PROVIDER })
    .maybeSingle() as never;
}

describe('a customer pays their own invoice', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    staff = await asPlatformStaff();
    shop = await newBusiness('pp-shop', { cardPayments: true });
    rival = await newBusiness('pp-rival', { cardPayments: false });
  });

  it('derives amount, currency and account from the invoice, not from its caller', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data, error } = await begin(db, shop.invoiceId);

    expect(error).toBeNull();
    expect(data).toMatchObject({
      currency: 'CAD',
      outstanding_minor: 12_000,
      account_id: `acct_${'pp-shop'}`,
    });
    expect(data!.request_id).toBeTypeOf('string');
  });

  it('writes a payment_requests row and never a payments row', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data } = await begin(db, shop.invoiceId);

    const { data: request } = await shop.db
      .from('payment_requests')
      .select('invoice_id, amount_minor, currency, provider')
      .eq('id', data!.request_id)
      .single();
    expect(request).toMatchObject({
      invoice_id: shop.invoiceId,
      amount_minor: 12_000,
      currency: 'CAD',
      provider: PROVIDER,
    });

    const { data: payments } = await shop.db
      .from('payments')
      .select('id')
      .eq('invoice_id', shop.invoiceId);
    expect(payments).toEqual([]);
  });

  it('lets the customer correct the request to the processor\'s real reference', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data } = await begin(db, shop.invoiceId);

    const { error } = await db.rpc('confirm_external_card_payment', {
      p_request_id: data!.request_id,
      p_provider_reference: 'cs_test_real_session',
    });
    expect(error).toBeNull();

    const { data: request } = await shop.db
      .from('payment_requests')
      .select('provider_reference')
      .eq('id', data!.request_id)
      .single();
    expect(request!.provider_reference).toBe('cs_test_real_session');
  });

  it('refuses another external customer\'s attempt to confirm someone else\'s request', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data } = await begin(db, shop.invoiceId);

    const other = await recognised(shop, shop.otherCustomerId);
    const { error } = await other.rpc('confirm_external_card_payment', {
      p_request_id: data!.request_id,
      p_provider_reference: 'cs_test_hijacked',
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('refuses another customer of the same business', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data, error } = await begin(db, shop.otherInvoiceId);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('refuses a forged invoice id from another tenant entirely', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data, error } = await begin(db, rival.invoiceId);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('exposes no more of payment_accounts than an account id', async () => {
    const db = await recognised(shop, shop.customerId);

    // No policy for the external axis at all (20260829000011's own rule) — an RLS table with a
    // grant but no matching policy returns an empty result rather than an error, the same shape
    // every other cross-tenant read in this repository resolves to. `begin_external_card_payment`'s
    // own result above is the only account detail this caller ever sees, and it is exactly one
    // field, `account_id`.
    const { data, error } = await db.from('payment_accounts').select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('refuses when card payments is not usable', async () => {
    const db = await recognised(rival, rival.customerId);
    const { data, error } = await begin(db, rival.invoiceId);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('refuses a settled invoice', async () => {
    const workItemId = await (async () => {
      const priceItemId = await createPriceBookItem(shop.db, {
        organizationId: shop.organizationId,
        name: 'Small job',
        unit: 'visit',
        unitAmountMinor: 3_000,
      });
      const typeId = await createWorkItemType(shop.db, { schedulable: true, organizationId: shop.organizationId, name: 'Settled type' });
      const statusId = await createWorkItemStatus(shop.db, { organizationId: shop.organizationId, typeId, name: 'Open settled' });
      const id = await createWorkItem(shop.db, {
        organizationId: shop.organizationId,
        title: 'Fully paid already',
        statusId,
        customerId: shop.customerId,
      });
      await addPricedLine(shop.db, { workItemId: id, priceBookItemId: priceItemId, quantity: 1 });
      return id;
    })();
    const settledInvoiceId = await issueInvoice(shop.db, { workItemId, dueAt: null });
    await recordPayment(shop.db, { invoiceId: settledInvoiceId, amountMinor: 3_000 });

    const db = await recognised(shop, shop.customerId);
    const { data, error } = await begin(db, settledInvoiceId);

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('GD001');
  });

  it('shows one tenant nothing of another\'s via the availability check either', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data, error } = await db
      .rpc('external_card_payment_availability', { p_invoice_id: rival.invoiceId, p_provider: PROVIDER })
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('answers available for a genuinely payable invoice, without writing anything', async () => {
    const before = await shop.db.from('payment_requests').select('id').eq('invoice_id', shop.otherInvoiceId);

    const db = await recognised(shop, shop.otherCustomerId);
    const { data, error } = await db
      .rpc('external_card_payment_availability', { p_invoice_id: shop.otherInvoiceId, p_provider: PROVIDER })
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toMatchObject({ outstanding_minor: 12_000, currency: 'CAD' });

    const after = await shop.db.from('payment_requests').select('id').eq('invoice_id', shop.otherInvoiceId);
    expect(after.data).toEqual(before.data);
  });
});

describe('the customer record\'s own invoice list', () => {
  it('shows every invoice a customer has been billed, across their work', async () => {
    const invoices = await listCustomerInvoices(shop.db, {
      organizationId: shop.organizationId,
      customerId: shop.customerId,
    });
    expect(invoices.map((invoice) => invoice.id)).toContain(shop.invoiceId);
    expect(invoices.map((invoice) => invoice.id)).not.toContain(shop.otherInvoiceId);
  });

  it('matches invoiceStanding() line for line against the per-invoice reader', async () => {
    // By id rather than by position — `shop.customerId` has gained a second, settled invoice
    // from an earlier test in this file by the time this one runs, and `listCustomerInvoices`
    // is newest-first.
    const invoices = await listCustomerInvoices(shop.db, {
      organizationId: shop.organizationId,
      customerId: shop.customerId,
    });
    const batched = invoices.find((invoice) => invoice.id === shop.invoiceId);
    const lines = await listInvoiceLines(shop.db, {
      organizationId: shop.organizationId,
      invoiceId: shop.invoiceId,
    });
    const payments = await listPayments(shop.db, {
      organizationId: shop.organizationId,
      invoiceId: shop.invoiceId,
    });

    expect(invoiceStanding(batched!)).toEqual(invoiceStanding({ lines, payments }));
  });

  it('shows another customer\'s invoices to nobody but them', async () => {
    const invoices = await listCustomerInvoices(shop.db, {
      organizationId: shop.organizationId,
      customerId: shop.otherCustomerId,
    });
    expect(invoices.map((invoice) => invoice.id)).toEqual([shop.otherInvoiceId]);
  });

  it('follows the invoice\'s own snapshotted customer, not a work item\'s current one', async () => {
    // The work item behind shop.invoiceId still names shop.customerId today, and nothing in
    // this repository can move it once invoiced — invoices carries no update policy at all, so
    // there is no path by which re-pointing the underlying job could even be attempted. What
    // this asserts instead is the shape of the guarantee: the reader filters on the invoice's
    // own `customer_id` directly rather than joining through `work_items.customer_id`, so it
    // would keep reporting the truth even if that guarantee were ever weakened.
    const { data: invoice } = await shop.db
      .from('invoices')
      .select('customer_id, work_item_id')
      .eq('id', shop.invoiceId)
      .single();
    const { data: workItem } = await shop.db
      .from('work_items')
      .select('customer_id')
      .eq('id', invoice!.work_item_id)
      .single();
    expect(invoice!.customer_id).toBe(workItem!.customer_id);
  });

  it('shows one tenant nothing of another\'s customer invoices', async () => {
    const invoices = await listCustomerInvoices(rival.db, {
      organizationId: shop.organizationId,
      customerId: shop.customerId,
    });
    expect(invoices).toEqual([]);
  });
});

describe('the operator\'s own reference-update grant (20260920000001)', () => {
  it('lets a caller with payment.record correct provider_reference after the fact', async () => {
    const requestId = randomUUID();
    const { error: insertError } = await shop.db.from('payment_requests').insert({
      id: requestId,
      organization_id: shop.organizationId,
      invoice_id: shop.invoiceId,
      provider: PROVIDER,
      provider_reference: requestId,
      amount_minor: 12_000,
      currency: 'CAD',
      created_by: (await shop.db.auth.getUser()).data.user!.id,
    });
    expect(insertError).toBeNull();

    // This is the exact call `requestCardPayment` makes after asking the processor. Before
    // 20260920000001 this failed with 42501 for every caller, operator included — `payment_requests`
    // carried select and insert to `authenticated` and nothing else.
    const { error } = await shop.db
      .from('payment_requests')
      .update({ provider_reference: 'cs_test_operator_real_session' })
      .eq('id', requestId);
    expect(error).toBeNull();

    const { data } = await shop.db
      .from('payment_requests')
      .select('provider_reference')
      .eq('id', requestId)
      .single();
    expect(data!.provider_reference).toBe('cs_test_operator_real_session');
  });

  it('still refuses a member without payment.record', async () => {
    const requestId = randomUUID();
    // Written while rival's founder still holds every capability — this is the operator's own
    // write, under their own JWT, before the demotion below takes anything away.
    const { error: insertError } = await rival.db.from('payment_requests').insert({
      id: requestId,
      organization_id: rival.organizationId,
      invoice_id: rival.invoiceId,
      provider: PROVIDER,
      provider_reference: requestId,
      amount_minor: 1,
      currency: 'CAD',
      created_by: (await rival.db.auth.getUser()).data.user!.id,
    });
    expect(insertError).toBeNull();

    const { data: membership } = await rival.db
      .from('memberships')
      .select('id')
      .eq('organization_id', rival.organizationId)
      .single();
    const limited = await createRole(rival.db, {
      organizationId: rival.organizationId,
      name: 'No Payments',
      capabilities: ['role.manage', 'customer.create'],
    });
    await assignRole(rival.db, { membershipId: membership!.id, roleId: limited });

    const { error } = await rival.db
      .from('payment_requests')
      .update({ provider_reference: 'cs_test_should_not_move' })
      .eq('id', requestId);
    // A refused UPDATE policy matches nothing rather than raising — proven by the value, the
    // same shape `change_work_item_status`'s own comment describes.
    expect(error).toBeNull();

    const { data } = await rival.db
      .from('payment_requests')
      .select('provider_reference')
      .eq('id', requestId)
      .single();
    expect(data!.provider_reference).toBe(requestId);
  });
});

/**
 * A payable invoice is still refused when the business is not entitled to card payments by its
 * plan, or when its published Portal does not offer payments on invoices. Both gates live in the
 * public entry points (`begin_external_card_payment`, `external_card_payment_availability`); a
 * deployment that lacked them still passed the module-switched-off case above, so each gate is
 * proved here on its own with everything else in place.
 */
describe('card payments also require plan entitlement and Portal invoice payments', () => {
  let unsold: Business;
  let hidden: Business;

  async function availability(db: SupabaseClient, invoiceId: string) {
    return db.rpc('external_card_payment_availability', { p_invoice_id: invoiceId, p_provider: PROVIDER });
  }

  beforeAll(async () => {
    staff ??= await asPlatformStaff();
    unsold = await newBusiness('pp-unsold', { cardPayments: true });
    hidden = await newBusiness('pp-hidden', { cardPayments: true });

    // A plan that sells the workspace product only: card payments are switched on and paid for,
    // but not entitled.
    const planId = await createPlan(staff, {
      key: `pp_unsold_${randomUUID().slice(0, 8)}`, kind: 'plan', label: 'No card payments',
      description: 'Test plan without card payments.', billable: false,
    });
    await grantPlanProduct(staff, { planId, productKey: 'workspace' });
    await recordPlanAssignment(staff, { organizationId: unsold.organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });

    // A published Portal whose invoices module does not offer payments.
    await recordCommercialTerm(staff, { organizationId: hidden.organizationId, productKey: 'module:portal', periodStart: '2026-01-01', periodEnd: '9999-12-31', priceMinor: 0, currency: 'CAD' });
    const draft = structuredClone(DEFAULT_PORTAL_CONTENT);
    draft.pages = draft.pages.map((page) => ({
      ...page,
      modules: page.modules.map((module) => (module.kind === 'invoices' ? { ...module, config: { ...module.config, payments: false } } : module)),
    }));
    const version = async () => (await portalEditorState(hidden.db as never, hidden.organizationId)).definition?.draft_version ?? 0;
    await savePortalDraft(hidden.db as never, hidden.organizationId, await version(), draft);
    await submitPortalDraft(hidden.db as never, hidden.organizationId, await version());
    await publishPortalDraft(hidden.db as never, hidden.organizationId, await version());
  });

  it('refuses a business whose plan does not include card payments', async () => {
    const db = await recognised(unsold, unsold.customerId);
    const { data, error } = await begin(db, unsold.invoiceId);
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
    expect((await availability(db, unsold.invoiceId)).data).toEqual([]);
  });

  it('refuses when the published Portal does not offer payments on invoices', async () => {
    const db = await recognised(hidden, hidden.customerId);
    const { data, error } = await begin(db, hidden.invoiceId);
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
    expect((await availability(db, hidden.invoiceId)).data).toEqual([]);
  });
});
