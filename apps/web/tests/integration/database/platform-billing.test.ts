import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPlan, getPlan, recordPlanPrice } from '@/lib/domain/catalogue/plans';
import { recordPlanAgreement, recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { ensurePlatformBillingCustomer } from '@/lib/domain/platform-billing/customers';
import { beginPlatformBillingCheckout } from '@/lib/domain/platform-billing/checkout';
import { beginPlatformBillingPortalSession } from '@/lib/domain/platform-billing/portal';
import { getOrganizationSubscription } from '@/lib/domain/platform-billing/subscriptions';
import { provisionAgreementPlanPrice, provisionPlanPrice } from '@/lib/domain/platform-billing/provisioning';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * GOLD charging the organization for its own subscription — the opposite money direction from
 * `invoices.test.ts`/`portal-payments.test.ts` (a customer paying the tenant). Every network
 * call to the billing provider is mocked (Phase 18: "no live Stripe calls in the automated test
 * suite") — what these tests prove is this repository's own authorization, idempotency and
 * isolation logic, never a vendor's API.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; organizationId: string; userId: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 8)}`,
    currency: 'CAD',
  });

  return { db, organizationId, userId: created.user.id };
}

async function restrictedMember(tenant: Tenant, label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  // A role that can do the day job but never `billing.manage`.
  const roleId = await createRole(tenant.db, {
    organizationId: tenant.organizationId,
    name: `No billing ${randomUUID().slice(0, 6)}`,
    capabilities: ['customer.create'],
  });
  await addMember(tenant.db, {
    organizationId: tenant.organizationId,
    email,
    displayName: label,
    roleId,
  });

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { db, organizationId: tenant.organizationId, userId: created.user.id };
}

// Captured before any test attaches a spy — every mock below delegates a non-Stripe URL (the
// Supabase client's own REST calls included) to this, and only ever fabricates a response for
// `api.stripe.com` (Phase 18: "no live Stripe calls in the automated test suite", not "no
// fetch calls at all" — the domain layer's own database reads still need to work).
const realFetch = globalThis.fetch.bind(globalThis);

let pg: Client;
let staff: SupabaseClient;
let tenant: Tenant;
let other: Tenant;
let noBillingMember: Tenant;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  staff = await asPlatformStaff();
  tenant = await newTenant('billing');
  other = await newTenant('billing-other');
  noBillingMember = await restrictedMember(tenant, 'no-billing');

  // A fixed key so `platformBillingProvider()` resolves to the sandbox stripe implementation —
  // no real network call is ever reached because `fetch` is mocked per test below.
  process.env.STRIPE_SECRET_KEY = 'sk_test_platform_billing_suite';
}, 60_000);

afterAll(async () => {
  await pg?.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockStripeFetch(responses: Record<string, unknown>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.includes('api.stripe.com')) return realFetch(input as never, init);

    for (const [path, body] of Object.entries(responses)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    throw new Error(`unexpected stripe fetch: ${url}`);
  });
}

/** For "the provider must never be reached" tests — records any Stripe-bound call rather than throwing, so a wrongly-reached call surfaces as a clear array assertion instead of masking the real failure. */
function spyOnStripeCalls(): { spy: ReturnType<typeof vi.spyOn>; calls: string[] } {
  const calls: string[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
    calls.push(url);
    return new Response(JSON.stringify({ id: 'unexpected' }), { status: 200 });
  });
  return { spy, calls };
}

/** Checkout now purchases only the Plan currently assigned to the business (work order C §3). */
async function assignPlan(organizationId: string, planId: string): Promise<void> {
  await recordPlanAssignment(staff, {
    organizationId,
    planId,
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: '9999-12-31',
    note: 'platform-billing.test.ts',
  });
}

/** Provisions a billable Plan/Price/provider-price mapping, returning the plan key. */
async function seedProvisionedPlan(currency = 'CAD'): Promise<{ planKey: string; planId: string; priceId: string }> {
  const key = `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const planId = await createPlan(staff, {
    key,
    kind: 'plan',
    label: `Plan ${key}`,
    description: '',
    billable: true,
  });
  const priceId = await recordPlanPrice(staff, {
    planId,
    currency,
    amountMinor: 9_900,
    billingInterval: 'month',
  });

  const fetchSpy = mockStripeFetch({
    '/v1/products': { id: `prod_${randomUUID().slice(0, 8)}` },
    '/v1/prices': { id: `price_${randomUUID().slice(0, 8)}` },
  });
  await provisionPlanPrice(staff, { planId, planPriceId: priceId });
  fetchSpy.mockRestore();

  return { planKey: key, planId, priceId };
}

describe('provisioning a Plan price with the billing provider', () => {
  it('is idempotent — a second provisioning attempt returns the same reference rather than creating a second Product/Price', async () => {
    const planId = await createPlan(staff, {
      key: `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      kind: 'plan',
      label: 'Idempotent Plan',
      description: '',
      billable: true,
    });
    const priceId = await recordPlanPrice(staff, { planId, currency: 'CAD', amountMinor: 5_000, billingInterval: 'month' });

    // Fresh per call rather than a literal counter — a leftover row from an earlier run of this
    // suite (no `db:reset` in between) must never collide with this run's own fixture on the
    // (environment, price_reference) unique index, the same discipline every other fabricated
    // id in this file already follows.
    let calls = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      calls += 1;
      return new Response(JSON.stringify({ id: `stub_${randomUUID().slice(0, 8)}` }), { status: 200 });
    });

    const first = await provisionPlanPrice(staff, { planId, planPriceId: priceId });
    const callsAfterFirst = calls;
    const second = await provisionPlanPrice(staff, { planId, planPriceId: priceId });

    expect(second).toEqual(first);
    // No further fetch — the second call reads the already-provisioned row rather than asking
    // the provider again.
    expect(calls).toBe(callsAfterFirst);

    fetchSpy.mockRestore();
  });

  it('is staff-only — a tenant cannot provision a price directly through the door', async () => {
    const planId = await createPlan(staff, {
      key: `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      kind: 'plan',
      label: 'Staff Only Plan',
      description: '',
      billable: true,
    });
    const priceId = await recordPlanPrice(staff, { planId, currency: 'CAD', amountMinor: 5_000, billingInterval: 'month' });

    const { error } = await tenant.db.rpc('record_plan_provider_price', {
      p_plan_price_id: priceId,
      p_environment: 'sandbox',
      p_product_reference: 'prod_forged',
      p_price_reference: 'price_forged',
    });
    expect(error).toBeTruthy();
  });

  it('is readable by staff alone; a business reaches only the one reference checkout needs, through a door that checks billing.manage', async () => {
    const { priceId } = await seedProvisionedPlan();

    const staffRead = await staff.from('platform_plan_provider_prices').select('id').eq('plan_price_id', priceId);
    expect((staffRead.data ?? []).length).toBeGreaterThan(0);

    // DENY: the table is no longer a tenant's to read, and what it still cannot do is write.
    const tenantRead = await tenant.db.from('platform_plan_provider_prices').select('id').eq('plan_price_id', priceId);
    expect(tenantRead.error).toBeNull();
    expect(tenantRead.data).toEqual([]);
    const forged = await tenant.db.from('platform_plan_provider_prices').insert({
      plan_price_id: priceId,
      environment: 'sandbox',
      product_reference: 'prod_forged',
      price_reference: 'price_forged',
      provisioned_by: tenant.userId,
    });
    expect(forged.error).toBeTruthy();

    // ALLOW: the owner of a business holds billing.manage there.
    const allowed = await tenant.db.rpc('plan_price_provider_reference', {
      p_organization_id: tenant.organizationId,
      p_plan_price_id: priceId,
      p_environment: 'sandbox',
    });
    expect(allowed.error).toBeNull();
    expect(allowed.data).toMatch(/^price_/);

    // DENY: another business's owner naming this business, an anonymous caller, and staff, who
    // are members of nothing, are each refused.
    const other = await newTenant('billing-other');
    const asks = [other.db, createClient(SUPABASE_URL, ANON_KEY), staff];
    for (const client of asks) {
      const refused = await client.rpc('plan_price_provider_reference', {
        p_organization_id: tenant.organizationId,
        p_plan_price_id: priceId,
        p_environment: 'sandbox',
      });
      expect(refused.error?.code).toBe('42501');
      expect(refused.data).toBeNull();
    }

    // A price that is not for sale yields nothing even to a billing manager.
    const unknown = await tenant.db.rpc('plan_price_provider_reference', {
      p_organization_id: tenant.organizationId,
      p_plan_price_id: randomUUID(),
      p_environment: 'sandbox',
    });
    expect(unknown.error).toBeNull();
    expect(unknown.data).toBeNull();
  });
});

describe('one Stripe-shaped Customer per organization', () => {
  it('is idempotent — repeat provisioning reuses the same customer reference and calls the provider only once', async () => {
    const org = await newTenant('customer-idempotent');
    let creations = 0;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      creations += 1;
      return new Response(JSON.stringify({ id: `cus_${creations}` }), { status: 200 });
    });

    const first = await ensurePlatformBillingCustomer(org.db, { organizationId: org.organizationId, email: null, name: 'Idempotent Co' });
    const second = await ensurePlatformBillingCustomer(org.db, { organizationId: org.organizationId, email: null, name: 'Idempotent Co' });

    expect(second).toEqual(first);
    expect(creations).toBe(1);

    fetchSpy.mockRestore();
  });

  it("keeps two organizations' customers from sharing a row, and out of each other's reach", async () => {
    // A fresh org rather than the module-shared `tenant` — the "refuses a member with no
    // billing.manage" test below depends on `tenant.organizationId` still having no customer row.
    const org = await newTenant('customer-isolation');
    const fetchSpy = mockStripeFetch({ '/v1/customers': { id: `cus_${randomUUID().slice(0, 8)}` } });
    await ensurePlatformBillingCustomer(org.db, { organizationId: org.organizationId, email: null, name: 'Tenant Co' });
    fetchSpy.mockRestore();

    const crossRead = await other.db.from('platform_billing_customers').select('id').eq('organization_id', org.organizationId);
    expect(crossRead.data ?? []).toEqual([]);
  });

  it('refuses a member with no billing.manage, and never asks the provider for one', async () => {
    const { spy, calls } = spyOnStripeCalls();

    await expect(
      ensurePlatformBillingCustomer(noBillingMember.db, {
        organizationId: noBillingMember.organizationId,
        email: null,
        name: 'Should not happen',
      }),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
    spy.mockRestore();
  });
});

describe('starting a subscription (Checkout)', () => {
  it('resolves the configured Plan to its provisioned price, and uses subscription mode', async () => {
    const org = await newTenant('checkout-resolve');
    const { planKey, planId } = await seedProvisionedPlan();
    await assignPlan(org.organizationId, planId);

    let checkoutBody = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      if (url.includes('/v1/customers')) return new Response(JSON.stringify({ id: 'cus_checkout_1' }), { status: 200 });
      if (url.includes('/v1/checkout/sessions')) {
        checkoutBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' }), { status: 200 });
      }
      throw new Error(`unexpected stripe fetch: ${url}`);
    });

    const result = await beginPlatformBillingCheckout(org.db, {
      organizationId: org.organizationId,
      planKey,
      organizationName: 'Tenant Co',
      organizationEmail: null,
      currency: 'CAD',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    });

    expect(result.url).toBe('https://checkout.stripe.test/cs_1');
    const params = new URLSearchParams(checkoutBody);
    expect(params.get('mode')).toBe('subscription');
    // The resolved server-side reference — never one the caller supplied.
    expect(params.get('line_items[0][price]')).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it('refuses a Plan not currently assigned to this business, even if it is sellable and priced', async () => {
    const org = await newTenant('checkout-unassigned');
    const { planKey } = await seedProvisionedPlan();
    // Deliberately no assignPlan() -- this business has never been given this Plan.
    const { spy, calls } = spyOnStripeCalls();

    await expect(
      beginPlatformBillingCheckout(org.db, {
        organizationId: org.organizationId,
        planKey,
        organizationName: 'Tenant Co',
        organizationEmail: null,
        currency: 'CAD',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      }),
    ).rejects.toMatchObject({ code: 'platform_billing.plan_not_assigned' });

    expect(calls).toEqual([]);
    spy.mockRestore();
  });

  it('refuses a Plan the browser names that has no provisioned price', async () => {
    const org = await newTenant('checkout-unprovisioned');
    const key = `unprovisioned_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const planId = await createPlan(staff, { key, kind: 'plan', label: 'Unprovisioned', description: '', billable: true });
    await recordPlanPrice(staff, { planId, currency: 'CAD', amountMinor: 1_000, billingInterval: 'month' });
    await assignPlan(org.organizationId, planId);
    void (await getPlan(staff, key)); // sanity: the plan itself resolves — only its provider price is missing

    const { spy, calls } = spyOnStripeCalls();

    await expect(
      beginPlatformBillingCheckout(org.db, {
        organizationId: org.organizationId,
        planKey: key,
        organizationName: 'Tenant Co',
        organizationEmail: null,
        currency: 'CAD',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      }),
    ).rejects.toMatchObject({ code: 'platform_billing.price_not_provisioned' });

    expect(calls).toEqual([]);
    spy.mockRestore();
  });

  it('refuses a member with no billing.manage, before the provider is ever asked', async () => {
    const org = await newTenant('checkout-nobilling');
    const { planKey, planId } = await seedProvisionedPlan();
    await assignPlan(org.organizationId, planId);
    const member = await restrictedMember(org, 'no-billing-checkout');
    const { spy, calls } = spyOnStripeCalls();

    await expect(
      beginPlatformBillingCheckout(member.db, {
        organizationId: org.organizationId,
        planKey,
        organizationName: 'Tenant Co',
        organizationEmail: null,
        currency: 'CAD',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
      }),
    ).rejects.toThrow();

    expect(calls).toEqual([]);
    spy.mockRestore();
  });

  it('records the checkout attempt before asking the provider, including the quote it was shown, and corrects it with the provider reference afterward', async () => {
    const org = await newTenant('checkout-record');
    const { planKey, planId } = await seedProvisionedPlan();
    await assignPlan(org.organizationId, planId);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      if (url.includes('/v1/customers')) return new Response(JSON.stringify({ id: 'cus_record_1' }), { status: 200 });
      if (url.includes('/v1/checkout/sessions')) {
        return new Response(JSON.stringify({ id: 'cs_record_1', url: 'https://checkout.stripe.test/cs_record_1' }), { status: 200 });
      }
      throw new Error(`unexpected stripe fetch: ${url}`);
    });

    await beginPlatformBillingCheckout(org.db, {
      organizationId: org.organizationId,
      planKey,
      organizationName: 'Tenant Co',
      organizationEmail: null,
      currency: 'CAD',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    });

    const { rows } = await pg.query(
      `select provider_reference, quote_snapshot, quote_version, expires_at
         from public.platform_billing_checkout_sessions
        where organization_id = $1 order by requested_at desc limit 1`,
      [org.organizationId],
    );
    expect(rows[0].provider_reference).toBe('cs_record_1');
    expect(rows[0].quote_snapshot?.recurring?.length).toBeGreaterThan(0);
    expect(rows[0].quote_version).toBeTruthy();
    expect(new Date(rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());

    fetchSpy.mockRestore();
  });
});

describe('multi-line checkout and negotiated prices', () => {
  /** Provisions a billable Add-on/Price/provider-price mapping, returning the plan key. */
  async function seedProvisionedAddon(
    billingInterval: 'month' | 'one_time' = 'month',
    currency = 'CAD',
  ): Promise<{ planId: string; priceId: string }> {
    const key = `addon_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const planId = await createPlan(staff, { key, kind: 'addon', label: `Addon ${key}`, description: '', billable: true });
    const priceId = await recordPlanPrice(staff, { planId, currency, amountMinor: 1_500, billingInterval });

    const fetchSpy = mockStripeFetch({
      '/v1/products': { id: `prod_${randomUUID().slice(0, 8)}` },
      '/v1/prices': { id: `price_${randomUUID().slice(0, 8)}` },
    });
    await provisionPlanPrice(staff, { planId, planPriceId: priceId });
    fetchSpy.mockRestore();

    return { planId, priceId };
  }

  it('sends one Stripe line item per Plan and Add-on currently assigned to the business', async () => {
    const org = await newTenant('checkout-multiline');
    const { planKey, planId } = await seedProvisionedPlan();
    await assignPlan(org.organizationId, planId);
    const { planId: addonPlanId } = await seedProvisionedAddon();
    await assignPlan(org.organizationId, addonPlanId);

    let checkoutBody = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      if (url.includes('/v1/customers')) return new Response(JSON.stringify({ id: 'cus_multiline_1' }), { status: 200 });
      if (url.includes('/v1/checkout/sessions')) {
        checkoutBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ id: 'cs_multi_1', url: 'https://checkout.stripe.test/cs_multi_1' }), {
          status: 200,
        });
      }
      throw new Error(`unexpected stripe fetch: ${url}`);
    });

    await beginPlatformBillingCheckout(org.db, {
      organizationId: org.organizationId,
      planKey,
      organizationName: 'Multiline Co',
      organizationEmail: null,
      currency: 'CAD',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    });

    const params = new URLSearchParams(checkoutBody);
    expect(params.get('line_items[0][price]')).toBeTruthy();
    expect(params.get('line_items[1][price]')).toBeTruthy();
    expect(params.get('line_items[0][price]')).not.toBe(params.get('line_items[1][price]'));
    expect(params.get('line_items[2][price]')).toBeNull();

    fetchSpy.mockRestore();
  });

  it('provisions and resolves an organization-specific negotiated price, never the Plan’s own standard one', async () => {
    const org = await newTenant('checkout-agreement');
    const agreementPlanKey = `agreement_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const planId = await createPlan(staff, {
      key: agreementPlanKey,
      kind: 'plan',
      label: 'Agreement Plan',
      description: '',
      billable: true,
    });
    await assignPlan(org.organizationId, planId);
    // No standard price at all -- only a negotiated one for this organization.
    await recordPlanAgreement(staff, { organizationId: org.organizationId, planId, currency: 'CAD', amountMinor: 42_000 });

    const fetchSpy = mockStripeFetch({
      '/v1/products': { id: `prod_agreement_${randomUUID().slice(0, 8)}` },
      '/v1/prices': { id: `price_agreement_${randomUUID().slice(0, 8)}` },
    });
    const provisioned = await provisionAgreementPlanPrice(staff, { organizationId: org.organizationId, planId, billingInterval: 'month' });
    fetchSpy.mockRestore();
    expect(provisioned.priceReference).toMatch(/^price_agreement_/);

    // Idempotent: a second provisioning call reads the row back rather than asking again.
    const { spy, calls } = spyOnStripeCalls();
    const second = await provisionAgreementPlanPrice(staff, { organizationId: org.organizationId, planId, billingInterval: 'month' });
    expect(second.priceReference).toBe(provisioned.priceReference);
    expect(calls).toEqual([]);
    spy.mockRestore();

    let checkoutBody = '';
    const checkoutFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      if (url.includes('/v1/customers')) return new Response(JSON.stringify({ id: 'cus_agreement_1' }), { status: 200 });
      if (url.includes('/v1/checkout/sessions')) {
        checkoutBody = String(init?.body ?? '');
        return new Response(JSON.stringify({ id: 'cs_agreement_1', url: 'https://checkout.stripe.test/cs_agreement_1' }), {
          status: 200,
        });
      }
      throw new Error(`unexpected stripe fetch: ${url}`);
    });

    await beginPlatformBillingCheckout(org.db, {
      organizationId: org.organizationId,
      planKey: agreementPlanKey,
      organizationName: 'Agreement Co',
      organizationEmail: null,
      currency: 'CAD',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
    });

    const params = new URLSearchParams(checkoutBody);
    expect(params.get('line_items[0][price]')).toBe(provisioned.priceReference);

    checkoutFetch.mockRestore();
  });

  it('is staff-only — a tenant cannot provision an agreement price directly through the door', async () => {
    const planId = await createPlan(staff, {
      key: `agreement_forge_${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      kind: 'plan',
      label: 'Forged Agreement Plan',
      description: '',
      billable: true,
    });

    const { error } = await tenant.db.rpc('record_agreement_provider_price', {
      p_organization_id: tenant.organizationId,
      p_plan_id: planId,
      p_environment: 'sandbox',
      p_billing_interval: 'month',
      p_product_reference: 'prod_forged',
      p_price_reference: 'price_forged',
    });
    expect(error).toBeTruthy();
  });
});

describe('the Customer Portal', () => {
  it("resolves the organization's own customer reference server-side, never from client input", async () => {
    const fetchSpy = mockStripeFetch({ '/v1/customers': { id: `cus_${randomUUID().slice(0, 8)}` } });
    await ensurePlatformBillingCustomer(tenant.db, { organizationId: tenant.organizationId, email: null, name: 'Portal Co' });
    fetchSpy.mockRestore();

    let capturedCustomer: string | null = null;
    const portalFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      if (url.includes('/v1/billing_portal/sessions')) {
        capturedCustomer = new URLSearchParams(String(init?.body ?? '')).get('customer');
        return new Response(JSON.stringify({ url: 'https://billing.stripe.test/portal_1' }), { status: 200 });
      }
      throw new Error(`unexpected stripe fetch: ${url}`);
    });

    const started = await beginPlatformBillingPortalSession(tenant.db, {
      organizationId: tenant.organizationId,
      returnUrl: 'https://app.test/return',
    });

    expect(started?.url).toBe('https://billing.stripe.test/portal_1');
    expect(capturedCustomer).toBeTruthy();

    portalFetch.mockRestore();
  });

  it('refuses a member with no billing.manage', async () => {
    await expect(
      beginPlatformBillingPortalSession(noBillingMember.db, {
        organizationId: noBillingMember.organizationId,
        returnUrl: 'https://app.test/return',
      }),
    ).rejects.toThrow();
  });
});

describe('the webhook: applying subscription events (called exactly as platform_billing_webhook would)', () => {
  async function seedCustomer(organizationId: string, customerReference: string, userId: string) {
    await pg.query(
      `insert into public.platform_billing_customers (organization_id, environment, customer_reference, created_by)
       values ($1, 'sandbox', $2, $3)`,
      [organizationId, customerReference, userId],
    );
  }

  it('creates and then updates a subscription, reflected in the tenant-readable cache', async () => {
    const org = await newTenant('webhook-lifecycle');
    const customerReference = `cus_${randomUUID().slice(0, 12)}`;
    await seedCustomer(org.organizationId, customerReference, org.userId);

    const subscriptionReference = `sub_${randomUUID().slice(0, 12)}`;
    const priceReference = `price_${randomUUID().slice(0, 8)}`;

    await pg.query(
      `select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        `evt_${randomUUID()}`,
        'customer.subscription.created',
        customerReference,
        subscriptionReference,
        priceReference,
        'trialing',
        'CAD',
        null,
        null,
        false,
        null,
        'stripe',
      ],
    );

    let subscription = await getOrganizationSubscription(org.db, { organizationId: org.organizationId });
    expect(subscription?.status).toBe('trialing');

    await pg.query(
      `select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        `evt_${randomUUID()}`,
        'customer.subscription.updated',
        customerReference,
        subscriptionReference,
        priceReference,
        'active',
        'CAD',
        1_700_000_000,
        1_702_600_000,
        false,
        null,
        'stripe',
      ],
    );

    subscription = await getOrganizationSubscription(org.db, { organizationId: org.organizationId });
    expect(subscription?.status).toBe('active');
    expect(subscription?.currentPeriodEnd).toBeTruthy();

    // Cross-tenant: nobody else can read it.
    const crossRead = await other.db
      .from('organization_platform_subscriptions')
      .select('id')
      .eq('organization_id', org.organizationId);
    expect(crossRead.data ?? []).toEqual([]);

    await pg.query(
      `select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        `evt_${randomUUID()}`,
        'customer.subscription.deleted',
        customerReference,
        subscriptionReference,
        priceReference,
        'canceled',
        'CAD',
        null,
        null,
        false,
        null,
        'stripe',
      ],
    );

    subscription = await getOrganizationSubscription(org.db, { organizationId: org.organizationId });
    expect(subscription).toBeNull();
  });

  it('is idempotent — the same event reference delivered twice applies once', async () => {
    const org = await newTenant('webhook-idempotent');
    const customerReference = `cus_${randomUUID().slice(0, 12)}`;
    await seedCustomer(org.organizationId, customerReference, org.userId);
    const subscriptionReference = `sub_${randomUUID().slice(0, 12)}`;
    const priceReference = `price_${randomUUID().slice(0, 8)}`;
    const eventReference = `evt_${randomUUID()}`;

    const args = [
      eventReference,
      'customer.subscription.updated',
      customerReference,
      subscriptionReference,
      priceReference,
      'active',
      'CAD',
      null,
      null,
      false,
      null,
      'stripe',
    ];
    await pg.query(`select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, args);

    // Same event reference, a different (wrong) status — proves the second delivery is a no-op
    // rather than reapplying, not merely that it doesn't error.
    const replay = [...args];
    replay[5] = 'canceled';
    await pg.query(`select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, replay);

    const subscription = await getOrganizationSubscription(org.db, { organizationId: org.organizationId });
    expect(subscription?.status).toBe('active');
  });

  it('safely ignores an event about a customer this platform never provisioned', async () => {
    const { rows } = await pg.query(
      `select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result`,
      [
        `evt_${randomUUID()}`,
        'customer.subscription.updated',
        `cus_unknown_${randomUUID().slice(0, 8)}`,
        `sub_${randomUUID().slice(0, 8)}`,
        `price_${randomUUID().slice(0, 8)}`,
        'active',
        'CAD',
        null,
        null,
        false,
        null,
        'stripe',
      ],
    );
    expect(rows[0].result).toBeNull();

    const ledger = await pg.query(`select count(*)::int as count from public.platform_billing_webhook_events where event_reference like 'evt_%unknown%'`);
    expect(ledger.rows[0].count).toBe(0);
  });

  it('fails loudly rather than guessing when a customer reference resolves to more than one organization', async () => {
    const orgA = await newTenant('webhook-collide-a');
    const orgB = await newTenant('webhook-collide-b');
    const collision = `cus_collide_${randomUUID().slice(0, 10)}`;
    await seedCustomer(orgA.organizationId, collision, orgA.userId);
    await seedCustomer(orgB.organizationId, collision, orgB.userId);

    await expect(
      pg.query(`select public.apply_platform_subscription_event($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
        `evt_${randomUUID()}`,
        'customer.subscription.updated',
        collision,
        `sub_${randomUUID().slice(0, 8)}`,
        `price_${randomUUID().slice(0, 8)}`,
        'active',
        'CAD',
        null,
        null,
        false,
        null,
        'stripe',
      ]),
    ).rejects.toThrow();
  });

  it('invoice notices are logged for diagnostics only, and never write a subscription row', async () => {
    const org = await newTenant('webhook-notice');
    const customerReference = `cus_${randomUUID().slice(0, 12)}`;
    await seedCustomer(org.organizationId, customerReference, org.userId);

    const { rows } = await pg.query(
      `select public.record_platform_billing_notice($1,$2,$3,$4) as result`,
      [`evt_${randomUUID()}`, 'invoice.paid', customerReference, 'stripe'],
    );
    expect(rows[0].result).toBe(org.organizationId);

    const subscription = await getOrganizationSubscription(org.db, { organizationId: org.organizationId });
    expect(subscription).toBeNull();
  });

  it('nobody but the webhook role holds execute on either function', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('authenticated', 'public.apply_platform_subscription_event(text,text,text,text,text,text,text,bigint,bigint,boolean,bigint,text)', 'execute') as authenticated_apply,
              has_function_privilege('platform_billing_webhook', 'public.apply_platform_subscription_event(text,text,text,text,text,text,text,bigint,bigint,boolean,bigint,text)', 'execute') as webhook_apply`,
    );
    expect(rows[0].authenticated_apply).toBe(false);
    expect(rows[0].webhook_apply).toBe(true);
  });
});

describe('never confused with tenant commerce', () => {
  it('the platform-billing domain layer never imports the Connect/tenant-commerce capability', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.resolve(import.meta.dirname, '..', '..', '..', 'lib', 'domain', 'platform-billing');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.ts'));
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), 'utf8');
      // Prose explaining the boundary (this file's own doc-comments included) would otherwise
      // trip its own scan — the same reason adapters.test.ts strips comments before looking.
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/@\/lib\/adapters\/payments/);
      expect(code, file).not.toMatch(/payment_accounts|ConnectedAccount/);
    }
  });
});
