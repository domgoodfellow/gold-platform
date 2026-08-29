import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueInvoice, recordPayment } from '@/lib/domain/billing/invoices';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import {
  claimPortalInvite,
  createPortalInvite,
  listPortalInvites,
  revokePortalInvite,
} from '@/lib/domain/portal/portal';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';

/**
 * D22's second surface, and the claim it exists to test.
 *
 * That record says: "whichever surface goes first pays for the model; the other two inherit
 * it." Booking paid. This file is whether that was true — the portal added exactly one column
 * to the axis, `external_actors.customer_id`, which D22 predicted it would need and which is
 * written by one privileged function on presentation of a token and by nothing else.
 *
 * **The two surfaces scope differently and both are here.** Booking scopes an outsider to rows
 * *they made*, because a booking visitor creates their own customer row. A customer of ten
 * years made nothing — the business did — so the portal scopes them to rows *about them*.
 * Every external policy now reads "rows I made, or rows about me", and the tests below check
 * that widening it did not widen anything else.
 *
 * **The link is the credential, and that is said out loud.** Anyone holding it is that
 * customer. Proving control of an email address needs a channel, and channels are M5's.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Business = {
  db: SupabaseClient;
  organizationId: string;
  customerId: string;
  otherCustomerId: string;
  workItemId: string;
  otherWorkItemId: string;
  invoiceId: string;
};

let shop: Business;
let rival: Business;

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function newBusiness(label: string): Promise<Business> {
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

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: 'Owner',
    p_timezone: 'America/Toronto',
    p_currency: 'CAD',
  });
  if (error) throw error;

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Callout' });
  const statusId = await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' });
  const priceItemId = await createPriceBookItem(db, {
    organizationId: orgId,
    name: 'Tyre change',
    unit: 'visit',
    unitAmountMinor: 12_000,
  });

  // The customer this test is about, and one they must never see.
  const customerId = await createCustomer(db, { organizationId: orgId, name: 'Ariane Blais' });
  const otherCustomerId = await createCustomer(db, {
    organizationId: orgId,
    name: 'Somebody Else',
  });

  const workItemId = await createWorkItem(db, {
    organizationId: orgId,
    title: 'Winter tyres',
    statusId,
    customerId,
  });
  const otherWorkItemId = await createWorkItem(db, {
    organizationId: orgId,
    title: 'Not yours',
    statusId,
    customerId: otherCustomerId,
  });

  await addPricedLine(db, { workItemId, priceBookItemId: priceItemId, quantity: 1 });
  const invoiceId = await issueInvoice(db, { workItemId, dueAt: null });

  return { db, organizationId: orgId, customerId, otherCustomerId, workItemId, otherWorkItemId, invoiceId };
}

/** A customer holding the link the business sent them. */
async function recognised(business: Business, customerId: string): Promise<SupabaseClient> {
  const token = await createPortalInvite(business.db, { customerId });
  const db = anonClient();
  await claimPortalInvite(db, { token });
  return db;
}

describe('a customer, in a portal', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    shop = await newBusiness('pt-shop');
    rival = await newBusiness('pt-rival');
  });

  it('sees their own work', async () => {
    const db = await recognised(shop, shop.customerId);

    const { data } = await db.from('work_items').select('id, title');
    expect(data!.map((row) => row.id)).toEqual([shop.workItemId]);
    expect(data![0].title).toBe('Winter tyres');
  });

  it('sees their own invoice, its lines and its payments', async () => {
    await recordPayment(shop.db, {
      invoiceId: shop.invoiceId,
      amountMinor: 5_000,
      note: 'Deposit, cash',
    });

    const db = await recognised(shop, shop.customerId);

    const { data: invoices } = await db.from('invoices').select('id, number, currency');
    expect(invoices!.map((row) => row.id)).toEqual([shop.invoiceId]);

    const { data: lines } = await db.from('invoice_lines').select('description');
    expect(lines!.map((row) => row.description)).toEqual(['Tyre change']);

    const { data: payments } = await db.from('payments').select('amount_minor');
    expect(payments!.map((row) => row.amount_minor)).toEqual([5_000]);
  });

  it('sees nothing of another customer of the same business', async () => {
    // The sharp one. Same tenant, same tables, same policies — and the scope is a customer
    // rather than an organization, so the row next to theirs is not theirs.
    const db = await recognised(shop, shop.customerId);

    const { data: items } = await db.from('work_items').select('id');
    expect(items!.map((row) => row.id)).not.toContain(shop.otherWorkItemId);

    const { data: customers } = await db.from('customers').select('id');
    expect(customers!.map((row) => row.id)).toEqual([shop.customerId]);
  });

  it('is in no tenant at all, exactly as a booking visitor is not', async () => {
    // The claim D22 rejected a membership row over. A recognised customer is still an
    // outsider: nothing about being known to a business puts them inside the function every
    // capability check runs through.
    const db = await recognised(shop, shop.customerId);

    const { data: memberships } = await db.from('memberships').select('id');
    expect(memberships).toEqual([]);

    const { data: roles } = await db.from('roles').select('id');
    expect(roles).toEqual([]);
  });

  it('can write nothing at all', async () => {
    const db = await recognised(shop, shop.customerId);
    const { data: user } = await db.auth.getUser();

    // Booking's one privileged write is `create_booking`, and it refuses a caller whose
    // binding names a customer already. A recognised customer reads and does nothing else.
    //
    // The update raises **nothing**: `title` is inside the column grant, so the privilege check
    // passes and the policy simply matches no rows — the silent shape that
    // `change_work_item_status` checks `returning` to catch. So the assertion that carries the
    // guarantee is the value, exactly as it is in `work-item-transitions.test.ts`.
    const { error: item } = await db
      .from('work_items')
      .update({ title: 'Reschedule this for me' })
      .eq('id', shop.workItemId);
    expect(item).toBeNull();

    const { data: after } = await shop.db
      .from('work_items')
      .select('title')
      .eq('id', shop.workItemId)
      .single();
    expect(after!.title).toBe('Winter tyres');

    const { error: payment } = await db.from('payments').insert({
      organization_id: shop.organizationId,
      invoice_id: shop.invoiceId,
      amount_minor: 999_999,
      currency: 'CAD',
      created_by: user.user!.id,
    });
    expect(payment).not.toBeNull();
  });

  it('cannot move its own binding to another customer', async () => {
    // The attack that removed `customer_id` from the binding in the first place. The column is
    // in no grant and the table has no update policy, so the only writer is the function that
    // demands a token.
    const db = await recognised(shop, shop.customerId);

    const { error } = await db
      .from('external_actors')
      .update({ customer_id: shop.otherCustomerId })
      .eq('user_id', (await db.auth.getUser()).data.user!.id);

    expect(error).not.toBeNull();
  });

  it('refuses a withdrawn link, and says the same thing as an invented one', async () => {
    const token = await createPortalInvite(shop.db, { customerId: shop.customerId });
    const [invite] = await listPortalInvites(shop.db, {
      organizationId: shop.organizationId,
      customerId: shop.customerId,
    });
    await revokePortalInvite(shop.db, { id: invite.id });

    // Identical messages on purpose: telling them apart would let somebody holding a revoked
    // link learn that it had once been real.
    await expect(claimPortalInvite(anonClient(), { token })).rejects.toMatchObject({
      code: 'portal.invalid_link',
    });
    await expect(
      claimPortalInvite(anonClient(), { token: 'not-a-real-token' }),
    ).rejects.toMatchObject({ code: 'portal.invalid_link' });
  });

  it('keeps a binding to exactly one tenant, even holding a second link', async () => {
    // A browser recognised by one business cannot be promoted into a customer of another. The
    // unique index on `user_id` is what makes that structural rather than polite (D22).
    const db = await recognised(shop, shop.customerId);
    const theirs = await createPortalInvite(rival.db, { customerId: rival.customerId });

    await expect(claimPortalInvite(db, { token: theirs })).rejects.toMatchObject({
      code: 'portal.invalid_link',
    });

    // And they still see their own business, unmoved.
    const { data } = await db.from('organizations').select('id');
    expect(data!.map((row) => row.id)).toEqual([shop.organizationId]);
  });

  it('shows the business its own invitations and never another’s', async () => {
    const { data } = await rival.db
      .from('customer_portal_invites')
      .select('id')
      .eq('organization_id', shop.organizationId);
    expect(data).toEqual([]);
  });
});
