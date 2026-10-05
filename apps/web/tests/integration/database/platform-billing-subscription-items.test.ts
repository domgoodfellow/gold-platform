import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPlan, recordPlanPrice } from '@/lib/domain/catalogue/plans';
import { recordPlanAgreement, recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { beginPlatformBillingCheckout } from '@/lib/domain/platform-billing/checkout';
import { loadPlanUsage } from '@/lib/application/settings/plan-usage';
import { buildOrganizationPurchaseQuote } from '@/lib/domain/platform-billing/quote';
import { getOrganizationBillingSubscriptionState } from '@/lib/domain/platform-billing/subscriptions';
import { describeSubscriptionPackage } from '@/lib/domain/platform-billing/subscription-package';
import { getOrganizationServiceAccess } from '@/lib/domain/platform-billing/service-access';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';
import { applySubscriptionEvent, type TestSubscriptionEvent } from '@/tests/support/subscription-events';

/**
 * C3: a provider subscription is its items, correlated to the checkout that bought it, and an
 * older event never overwrites a newer one. The webhook's own database function is invoked directly
 * as `platform_billing_webhook` would; the provider is never called (checkout's one outbound call is
 * stubbed to capture what it asks for).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; organizationId: string; userId: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  return { db, organizationId, userId: created.user.id };
}

const realFetch = globalThis.fetch.bind(globalThis);
let pg: Client;
let staff: SupabaseClient;

beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();
  process.env.STRIPE_SECRET_KEY = 'sk_test_subscription_items_suite';
}, 60_000);

afterAll(async () => {
  await pg?.end();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

let clock = 1_800_000_000;
const tick = () => (clock += 10);

async function seedCustomer(tenant: Tenant): Promise<string> {
  const reference = `cus_${randomUUID().slice(0, 12)}`;
  await pg.query(
    `insert into public.platform_billing_customers (organization_id, environment, customer_reference, created_by)
     values ($1, 'sandbox', $2, $3)`,
    [tenant.organizationId, reference, tenant.userId],
  );
  return reference;
}

/** A Plan or Add-on whose standard price is mapped to a provider price, without any provider call. */
async function standardPlan(kind: 'plan' | 'addon', interval: 'month' | 'one_time' = 'month') {
  const key = `${kind}_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const planId = await createPlan(staff, { key, kind, label: `${kind} ${key.slice(-6)}`, description: '', billable: true });
  const planPriceId = await recordPlanPrice(staff, { planId, currency: 'CAD', amountMinor: 5_000, billingInterval: interval });
  const priceReference = `price_${randomUUID().slice(0, 10)}`;
  const mapped = await staff.rpc('record_plan_provider_price', {
    p_plan_price_id: planPriceId, p_environment: 'sandbox', p_product_reference: `prod_${randomUUID().slice(0, 8)}`,
    p_price_reference: priceReference,
  });
  expect(mapped.error).toBeNull();
  return { key, planId, planPriceId, priceReference };
}

/** A negotiated price for one organization, mapped to its own provider price. */
async function agreementPlan(tenant: Tenant, kind: 'plan' | 'addon' = 'plan') {
  const key = `agr_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const planId = await createPlan(staff, { key, kind, label: `agreement ${key.slice(-6)}`, description: '', billable: true });
  await recordPlanAssignment(staff, {
    organizationId: tenant.organizationId, planId, periodStart: new Date().toISOString().slice(0, 10), periodEnd: '9999-12-31',
  });
  const agreementId = await recordPlanAgreement(staff, {
    organizationId: tenant.organizationId, planId, currency: 'CAD', amountMinor: 42_000,
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
  });
  const priceReference = `price_agr_${randomUUID().slice(0, 10)}`;
  const mapped = await staff.rpc('record_agreement_provider_price', {
    p_agreement_id: agreementId, p_environment: 'sandbox', p_billing_interval: 'month',
    p_product_reference: `prod_${randomUUID().slice(0, 8)}`, p_price_reference: priceReference,
  });
  expect(mapped.error).toBeNull();
  return { key, planId, agreementId, priceReference };
}

/** A checkout row whose snapshot reviewed these recurring and due-now provider prices, as checkout.ts writes it. */
async function seedSession(
  tenant: Tenant,
  recurring: { priceReference: string; quantity?: number }[],
  dueNow: { priceReference: string; quantity?: number }[] = [],
): Promise<string> {
  const lines = (list: typeof recurring) => list.map((l) => ({ quantity: l.quantity ?? 1 }));
  const snapshot = {
    organizationId: tenant.organizationId,
    recurring: lines(recurring),
    dueNow: lines(dueNow),
    providerLines: [...recurring, ...dueNow].map((l) => ({ providerPriceReference: l.priceReference, quantity: l.quantity ?? 1 })),
  };
  const { rows } = await pg.query(
    `insert into public.platform_billing_checkout_sessions
       (organization_id, environment, requested_by, quote_snapshot, quote_version, expires_at)
     values ($1, 'sandbox', $2, $3, 'v', now() + interval '30 minutes') returning id`,
    [tenant.organizationId, tenant.userId, JSON.stringify(snapshot)],
  );
  return rows[0].id;
}

async function parent(tenant: Tenant) {
  const { rows } = await pg.query(`select * from public.organization_platform_subscriptions where organization_id = $1`, [tenant.organizationId]);
  return rows[0];
}

async function items(tenant: Tenant, subscriptionReference?: string) {
  const { rows } = await pg.query(
    `select * from public.organization_platform_subscription_items
      where organization_id = $1 and ($2::text is null or subscription_reference = $2)
      order by provider_item_reference`,
    [tenant.organizationId, subscriptionReference ?? null],
  );
  return rows;
}

function event(customerReference: string, subscriptionReference: string, over: Partial<TestSubscriptionEvent> & Pick<TestSubscriptionEvent, 'items'>): TestSubscriptionEvent {
  return { customerReference, subscriptionReference, createdAt: tick(), ...over };
}

// ---------------------------------------------------------------------------
// checkout → provider subscription, end to end
// ---------------------------------------------------------------------------

describe('a checkout puts its own id on the subscription it creates, and the webhook reconciles to it', () => {
  it('carries the correlation to the provider, then matches the provider items to the reviewed recurring package — one-time line excluded, order irrelevant', async () => {
    const org = await newTenant('c3-e2e');
    const base = await standardPlan('plan');
    const addon = await standardPlan('addon');
    const oneTime = await standardPlan('addon', 'one_time');
    for (const plan of [base, addon, oneTime]) {
      await recordPlanAssignment(staff, {
        organizationId: org.organizationId, planId: plan.planId,
        periodStart: new Date().toISOString().slice(0, 10), periodEnd: '9999-12-31',
      });
    }

    let checkoutBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      if (url.includes('/v1/customers')) return new Response(JSON.stringify({ id: `cus_${randomUUID().slice(0, 10)}` }), { status: 200 });
      checkoutBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: 'cs_c3', url: 'https://checkout.stripe.test/c3' }), { status: 200 });
    });

    const quote = await buildOrganizationPurchaseQuote(org.db, { organizationId: org.organizationId });
    expect(quote.blockers).toEqual([]);
    await beginPlatformBillingCheckout(org.db, {
      organizationId: org.organizationId, planKey: base.key, reviewedQuoteVersion: quote.reviewVersion,
      organizationName: 'C3 Co', organizationEmail: null, currency: 'CAD',
      successUrl: 'https://app.test/ok', cancelUrl: 'https://app.test/no',
    });

    const { rows: sessions } = await pg.query(`select id from public.platform_billing_checkout_sessions where organization_id = $1`, [org.organizationId]);
    expect(sessions).toHaveLength(1);
    const sessionId: string = sessions[0].id;
    expect(new URLSearchParams(checkoutBody).get('subscription_data[metadata][gildops_checkout_session_id]')).toBe(sessionId);

    const { rows: customers } = await pg.query(`select customer_reference from public.platform_billing_customers where organization_id = $1`, [org.organizationId]);
    const customerReference: string = customers[0].customer_reference;

    // The provider lists only the two recurring items; the one-time fee is not a subscription item.
    const providerItems = [
      { itemReference: 'si_base', priceReference: base.priceReference, periodStart: 1_800_000_000, periodEnd: 1_802_600_000 },
      { itemReference: 'si_addon', priceReference: addon.priceReference, periodStart: 1_800_100_000, periodEnd: 1_802_700_000 },
    ];
    await applySubscriptionEvent(pg, event(customerReference, 'sub_e2e', {
      type: 'customer.subscription.created', checkoutCorrelation: sessionId, items: [...providerItems].reverse(),
    }));

    const row = await parent(org);
    expect(row.reconciliation_state).toBe('matched');
    expect(row.checkout_session_id).toBe(sessionId);
    expect(row.base_item_reference).toBe('si_base');

    const { rows: confirmed } = await pg.query(`select * from public.platform_billing_checkout_sessions where id = $1`, [sessionId]);
    expect(confirmed[0].provider_subscription_reference).toBe('sub_e2e');
    expect(confirmed[0].provider_confirmed_at).toBeTruthy();
    expect(confirmed[0].reconciliation_state).toBe('matched');
    // The snapshot is purchase intent and is never rewritten by confirmation.
    expect(confirmed[0].quote_snapshot.dueNow).toHaveLength(1);

    // The tenant's own reading: canonical labels, base Plan first, no raw provider ids.
    const state = await getOrganizationBillingSubscriptionState(org.db, { organizationId: org.organizationId });
    expect(state?.items).toHaveLength(2);
    expect(state?.items.every((i) => i.canonicalSource?.domain === 'catalogue.plan_price')).toBe(true);
    const summary = describeSubscriptionPackage(state!.items, [
      { id: base.planId, label: 'Base', kind: 'plan' },
      { id: addon.planId, label: 'Add-on', kind: 'addon' },
    ]);
    expect(summary).toEqual({ basePlanLabel: 'Base', addons: [{ label: 'Add-on', quantity: 1 }], itemsNeedingReview: 0 });
  }, 60_000);
});

// ---------------------------------------------------------------------------
// C2 preflight: Subscribe is the quote's answer, not a standard-price lookup's
// ---------------------------------------------------------------------------

describe('the Plan & usage screen offers checkout whenever the authoritative quote can be bought', () => {
  const asBillingManager = (org: Tenant) => ({ organizationId: org.organizationId, currency: 'CAD', capabilities: ['billing.manage'] });

  it('offers an agreement-only Plan — no standard price at all — and checkout buys the exact agreement Price', async () => {
    const org = await newTenant('c3-agreement-only');
    const agreement = await agreementPlan(org);

    const model = await loadPlanUsage(org.db, asBillingManager(org));
    expect(model.subscription).toBeNull();
    expect(model.quote?.blockers).toEqual([]);
    expect(model.quote?.recurring[0]).toMatchObject({ priceSourceDomain: 'catalogue.plan_agreement', priceSourceId: agreement.agreementId });
    expect(model.canSubscribe).toBe(true);

    let checkoutBody = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes('api.stripe.com')) return realFetch(input as never, init);
      if (url.includes('/v1/customers')) return new Response(JSON.stringify({ id: `cus_${randomUUID().slice(0, 10)}` }), { status: 200 });
      checkoutBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ id: 'cs_agr', url: 'https://checkout.stripe.test/agr' }), { status: 200 });
    });
    await beginPlatformBillingCheckout(org.db, {
      organizationId: org.organizationId, planKey: agreement.key, reviewedQuoteVersion: model.quote!.reviewVersion,
      organizationName: 'Agreement Only Co', organizationEmail: null, currency: 'CAD',
      successUrl: 'https://app.test/ok', cancelUrl: 'https://app.test/no',
    });
    expect(new URLSearchParams(checkoutBody).get('line_items[0][price]')).toBe(agreement.priceReference);
  });

  it('does not offer a package the quote cannot buy, and says why', async () => {
    const org = await newTenant('c3-blocked');
    const planId = await createPlan(staff, { key: `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`, kind: 'plan', label: 'Unpriced', description: '', billable: true });
    await recordPlanAssignment(staff, { organizationId: org.organizationId, planId, periodStart: new Date().toISOString().slice(0, 10), periodEnd: '9999-12-31' });
    const model = await loadPlanUsage(org.db, asBillingManager(org));
    expect(model.canSubscribe).toBe(false);
    expect(model.quote?.blockers[0]?.code).toBe('no_plan_price');
  });

  it('reads a confirmed multi-item subscription as the package it is, and an ended one as no subscription at all', async () => {
    const org = await newTenant('c3-package');
    const customer = await seedCustomer(org);
    const base = await standardPlan('plan');
    const addon = await standardPlan('addon');
    for (const plan of [base, addon]) {
      await recordPlanAssignment(staff, { organizationId: org.organizationId, planId: plan.planId, periodStart: new Date().toISOString().slice(0, 10), periodEnd: '9999-12-31' });
    }
    const providerItems = [
      { itemReference: 'si_base', priceReference: base.priceReference },
      { itemReference: 'si_addon', priceReference: addon.priceReference },
      { itemReference: 'si_unknown', priceReference: 'price_nobody_mapped' },
    ];
    await applySubscriptionEvent(pg, event(customer, 'sub_pkg', { items: providerItems }));

    let model = await loadPlanUsage(org.db, asBillingManager(org));
    expect(model.subscription?.status).toBe('active');
    expect(model.quote).toBeNull();
    expect(model.subscriptionPackage?.addons).toHaveLength(1);
    expect(model.subscriptionPackage?.itemsNeedingReview).toBe(1);
    expect(model.subscriptionPackage?.basePlanLabel).toBeTruthy();

    await applySubscriptionEvent(pg, event(customer, 'sub_pkg', { type: 'customer.subscription.deleted', status: 'canceled', items: providerItems }));
    model = await loadPlanUsage(org.db, asBillingManager(org));
    expect(model.subscription).toBeNull();
    expect(model.subscriptionPackage).toBeNull();
    expect(model.canSubscribe).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reconciliation rules
// ---------------------------------------------------------------------------

describe('reconciling provider items against the reviewed recurring package', () => {
  async function scenario(label: string) {
    const org = await newTenant(label);
    const customer = await seedCustomer(org);
    const base = await standardPlan('plan');
    const addon = await standardPlan('addon');
    return { org, customer, base, addon, sub: `sub_${randomUUID().slice(0, 10)}` };
  }

  it('matches the same items in any order, and a reviewed one-time line absent from the subscription is not a mismatch', async () => {
    const { org, customer, base, addon, sub } = await scenario('c3-match');
    const oneTime = await standardPlan('addon', 'one_time');
    const session = await seedSession(org, [base, addon], [oneTime]);
    await applySubscriptionEvent(pg, event(customer, sub, {
      checkoutCorrelation: session,
      items: [{ itemReference: 'si_2', priceReference: addon.priceReference }, { itemReference: 'si_1', priceReference: base.priceReference }],
    }));
    const row = await parent(org);
    expect(row.reconciliation_state).toBe('matched');
    expect(row.reconciliation_detail).toEqual([]);
  });

  it('reports a missing Add-on, an extra provider item and a wrong quantity as mismatches — never as matched', async () => {
    const { org, customer, base, addon, sub } = await scenario('c3-mismatch');
    const session = await seedSession(org, [base, addon]);

    await applySubscriptionEvent(pg, event(customer, sub, {
      checkoutCorrelation: session, items: [{ itemReference: 'si_1', priceReference: base.priceReference }],
    }));
    let row = await parent(org);
    expect(row.reconciliation_state).toBe('mismatch');
    expect(row.reconciliation_detail).toEqual([
      expect.objectContaining({ code: 'missing_recurring_price', price_reference: addon.priceReference }),
    ]);

    const extra = await standardPlan('addon');
    await applySubscriptionEvent(pg, event(customer, sub, {
      checkoutCorrelation: session,
      items: [
        { itemReference: 'si_1', priceReference: base.priceReference },
        { itemReference: 'si_2', priceReference: addon.priceReference },
        { itemReference: 'si_3', priceReference: extra.priceReference },
      ],
    }));
    row = await parent(org);
    expect(row.reconciliation_state).toBe('mismatch');
    expect(row.reconciliation_detail).toEqual([
      expect.objectContaining({ code: 'unexpected_recurring_price', price_reference: extra.priceReference }),
    ]);

    await applySubscriptionEvent(pg, event(customer, sub, {
      checkoutCorrelation: session,
      items: [
        { itemReference: 'si_1', priceReference: base.priceReference },
        { itemReference: 'si_2', priceReference: addon.priceReference, quantity: 4 },
      ],
    }));
    row = await parent(org);
    expect(row.reconciliation_state).toBe('mismatch');
    expect(row.reconciliation_detail).toEqual([
      expect.objectContaining({ code: 'quantity_mismatch', price_reference: addon.priceReference, expected_quantity: 1, actual_quantity: 4 }),
    ]);

    // The provider's state was recorded all the same: evidence is never discarded.
    expect((await items(org, sub)).filter((i) => i.active)).toHaveLength(2);
    // Mismatch is attention, not an access decision or an assignment change.
    const { rows: assignments } = await pg.query(`select count(*)::int as n from public.organization_plan_assignments where organization_id = $1`, [org.organizationId]);
    expect(assignments[0].n).toBe(0);
  });

  it('keeps a provider Price GildOps does not know, flagged, and never calls it matched', async () => {
    const { org, customer, base, sub } = await scenario('c3-unmapped');
    const session = await seedSession(org, [base, { priceReference: 'price_outside_gildops' }]);
    await applySubscriptionEvent(pg, event(customer, sub, {
      checkoutCorrelation: session,
      items: [
        { itemReference: 'si_1', priceReference: base.priceReference },
        { itemReference: 'si_x', priceReference: 'price_outside_gildops' },
      ],
    }));
    const unknown = (await items(org, sub)).find((i) => i.provider_item_reference === 'si_x');
    expect(unknown).toMatchObject({ canonical_source_domain: null, canonical_source_record_id: null, plan_id: null, active: true });
    const row = await parent(org);
    expect(row.reconciliation_state).toBe('mismatch');
    expect(row.reconciliation_detail).toEqual([expect.objectContaining({ code: 'unmapped_provider_price', price_reference: 'price_outside_gildops' })]);

    // And to the customer it is a neutral review state, never the provider id.
    const state = await getOrganizationBillingSubscriptionState(org.db, { organizationId: org.organizationId });
    const summary = describeSubscriptionPackage(state!.items, [{ id: base.planId, label: 'Base', kind: 'plan' }]);
    expect(summary.itemsNeedingReview).toBe(1);
    expect(JSON.stringify(summary)).not.toContain('price_outside_gildops');
  });

  it('maps a negotiated price to its exact agreement, only inside the organization it was provisioned for', async () => {
    const { org, customer, sub } = await scenario('c3-agreement');
    const agreement = await agreementPlan(org);
    await applySubscriptionEvent(pg, event(customer, sub, {
      items: [{ itemReference: 'si_agr', priceReference: agreement.priceReference }],
    }));
    const [mapped] = await items(org, sub);
    expect(mapped).toMatchObject({
      canonical_source_domain: 'catalogue.plan_agreement', canonical_source_record_id: agreement.agreementId, plan_id: agreement.planId,
    });
    expect((await parent(org)).base_item_reference).toBe('si_agr');

    // Another business presenting the same provider Price reference is not matched to this agreement.
    const stranger = await newTenant('c3-agreement-stranger');
    const strangerCustomer = await seedCustomer(stranger);
    await applySubscriptionEvent(pg, event(strangerCustomer, `sub_${randomUUID().slice(0, 8)}`, {
      items: [{ itemReference: 'si_agr', priceReference: agreement.priceReference }],
    }));
    const [foreign] = await items(stranger);
    expect(foreign.canonical_source_record_id).toBeNull();
    expect(foreign.plan_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// correlation is not authorization
// ---------------------------------------------------------------------------

describe('a checkout correlation never chooses the organization', () => {
  it('links a valid correlation, refuses another business’s, records provider truth for an invented one, and calls a missing one legacy', async () => {
    const org = await newTenant('c3-corr');
    const customer = await seedCustomer(org);
    const stranger = await newTenant('c3-corr-stranger');
    await seedCustomer(stranger);
    const base = await standardPlan('plan');

    const own = await seedSession(org, [base]);
    const foreign = await seedSession(stranger, [base]);
    const items1 = [{ itemReference: 'si_1', priceReference: base.priceReference }];

    // Another business's checkout id on THIS business's customer's subscription.
    await applySubscriptionEvent(pg, event(customer, 'sub_a', { checkoutCorrelation: foreign, items: items1 }));
    let row = await parent(org);
    expect(row.checkout_session_id).toBeNull();
    expect(row.reconciliation_state).toBe('mismatch');
    expect(row.reconciliation_detail).toEqual([expect.objectContaining({ code: 'checkout_correlation_invalid', reason: 'other_organization' })]);
    // The event landed on the organization its Customer belongs to, and the other business's checkout is untouched.
    expect(await parent(stranger)).toBeUndefined();
    const { rows: foreignSession } = await pg.query(`select provider_subscription_reference, reconciliation_state from public.platform_billing_checkout_sessions where id = $1`, [foreign]);
    expect(foreignSession[0]).toEqual({ provider_subscription_reference: null, reconciliation_state: null });

    // An invented id: provider truth is still recorded, the correlation is invalid.
    await applySubscriptionEvent(pg, event(customer, 'sub_a', { checkoutCorrelation: randomUUID(), items: items1 }));
    row = await parent(org);
    expect(row.status).toBe('active');
    expect(row.reconciliation_detail).toEqual([expect.objectContaining({ reason: 'unknown_checkout' })]);
    await applySubscriptionEvent(pg, event(customer, 'sub_a', { checkoutCorrelation: 'not-a-uuid', items: items1 }));
    expect((await parent(org)).reconciliation_detail).toEqual([expect.objectContaining({ reason: 'malformed' })]);

    // None at all: honest legacy, still cached.
    await applySubscriptionEvent(pg, event(customer, 'sub_a', { items: items1 }));
    row = await parent(org);
    expect(row.reconciliation_state).toBe('legacy_unlinked');
    expect(row.checkout_session_id).toBeNull();
    expect(await items(org, 'sub_a')).toHaveLength(1);

    // Its own, valid.
    await applySubscriptionEvent(pg, event(customer, 'sub_a', { checkoutCorrelation: own, items: items1 }));
    row = await parent(org);
    expect(row.checkout_session_id).toBe(own);
    expect(row.reconciliation_state).toBe('matched');
  });
});

// ---------------------------------------------------------------------------
// ordering
// ---------------------------------------------------------------------------

describe('the provider’s own clock orders subscription state', () => {
  async function seeded(label: string) {
    const org = await newTenant(label);
    const customer = await seedCustomer(org);
    const base = await standardPlan('plan');
    const addon = await standardPlan('addon');
    return { org, customer, base, addon, sub: `sub_${randomUUID().slice(0, 10)}` };
  }

  it('does not let a delayed older event regress status, a removed Add-on, or a cancellation', async () => {
    const { org, customer, base, addon, sub } = await seeded('c3-order');
    const both = [
      { itemReference: 'si_base', priceReference: base.priceReference },
      { itemReference: 'si_addon', priceReference: addon.priceReference },
    ];
    const t1 = tick(); const t2 = tick(); const t3 = tick();

    const created = event(customer, sub, { type: 'customer.subscription.created', status: 'active', createdAt: t1, items: both });
    await applySubscriptionEvent(pg, created);

    // T2: past_due, and the Add-on was removed.
    await applySubscriptionEvent(pg, event(customer, sub, { status: 'past_due', createdAt: t2, items: [both[0]!] }));
    expect((await parent(org)).status).toBe('past_due');
    expect((await items(org, sub)).find((i) => i.provider_item_reference === 'si_addon')?.active).toBe(false);

    // The delayed T1 arrives again (a different delivery, so not the idempotent no-op).
    expect(await applySubscriptionEvent(pg, { ...created, eventReference: `evt_late_${randomUUID()}` })).toBe(org.organizationId);
    expect((await parent(org)).status).toBe('past_due');
    expect((await items(org, sub)).find((i) => i.provider_item_reference === 'si_addon')?.active).toBe(false);

    // T3: deleted. Then a delayed T2-era "updated active" cannot resurrect anything.
    await applySubscriptionEvent(pg, event(customer, sub, { type: 'customer.subscription.deleted', status: 'canceled', createdAt: t3, items: [both[0]!] }));
    expect((await parent(org)).status).toBe('canceled');
    expect((await items(org, sub)).every((i) => !i.active && i.removed_at)).toBe(true);
    await applySubscriptionEvent(pg, event(customer, sub, { status: 'active', createdAt: t2, items: both }));
    expect((await parent(org)).status).toBe('canceled');
    expect((await items(org, sub)).every((i) => !i.active)).toBe(true);

    // Every delivery is in the diagnostics; the stale ones say so.
    const { rows } = await pg.query(
      `select application, count(*)::int as n from public.platform_billing_webhook_events where organization_id = $1 group by 1 order by 1`, [org.organizationId]);
    expect(rows).toEqual([{ application: 'applied', n: 3 }, { application: 'stale', n: 2 }]);
  });

  it('is idempotent on the provider event reference', async () => {
    const { org, customer, base, sub } = await seeded('c3-idem');
    const e = event(customer, sub, { eventReference: `evt_${randomUUID()}`, items: [{ itemReference: 'si_1', priceReference: base.priceReference }] });
    expect(await applySubscriptionEvent(pg, e)).toBe(org.organizationId);
    expect(await applySubscriptionEvent(pg, { ...e, status: 'canceled', createdAt: e.createdAt + 5 })).toBeNull();
    expect((await parent(org)).status).toBe('active');
  });

  it('does not let receipt order decide two conflicting events at the same provider instant — it keeps state and flags staff', async () => {
    const { org, customer, base, sub } = await seeded('c3-equal');
    const at = tick();
    const items1 = [{ itemReference: 'si_1', priceReference: base.priceReference }];
    await applySubscriptionEvent(pg, event(customer, sub, { status: 'active', createdAt: at, items: items1 }));

    // Same instant, saying the same thing: nothing to decide.
    await applySubscriptionEvent(pg, event(customer, sub, { status: 'active', createdAt: at, items: items1 }));
    expect((await parent(org)).reconciliation_state).not.toBe('ambiguous');

    // Same instant, conflicting: not applied, attention raised.
    await applySubscriptionEvent(pg, event(customer, sub, { status: 'unpaid', createdAt: at, items: items1 }));
    const row = await parent(org);
    expect(row.status).toBe('active');
    expect(row.reconciliation_state).toBe('ambiguous');
    expect(row.reconciliation_detail).toEqual([expect.objectContaining({ code: 'equal_provider_timestamp_conflict' })]);
    const { rows } = await pg.query(`select 1 from public.platform_billing_webhook_events where organization_id = $1 and application = 'ambiguous'`, [org.organizationId]);
    expect(rows).toHaveLength(1);

    // A strictly newer event resolves it.
    await applySubscriptionEvent(pg, event(customer, sub, { status: 'unpaid', createdAt: at + 1, items: items1 }));
    const resolved = await parent(org);
    expect(resolved.status).toBe('unpaid');
    expect(resolved.reconciliation_state).not.toBe('ambiguous');
  });
});

// ---------------------------------------------------------------------------
// the billing period
// ---------------------------------------------------------------------------

describe('the parent’s billing period follows the base Plan item, not the order items arrive in', () => {
  it('anchors on the base Plan item whichever way round the provider lists them', async () => {
    const org = await newTenant('c3-period');
    const customer = await seedCustomer(org);
    const base = await standardPlan('plan');
    const addon = await standardPlan('addon');
    const baseItem = { itemReference: 'si_base', priceReference: base.priceReference, periodStart: 1_800_000_000, periodEnd: 1_802_000_000 };
    const addonItem = { itemReference: 'si_addon', priceReference: addon.priceReference, periodStart: 1_801_000_000, periodEnd: 1_803_000_000 };
    const seconds = (v: Date) => Math.floor(new Date(v).getTime() / 1000);

    await applySubscriptionEvent(pg, event(customer, 'sub_p', { items: [addonItem, baseItem] }));
    let row = await parent(org);
    expect([seconds(row.current_period_start), seconds(row.current_period_end)]).toEqual([1_800_000_000, 1_802_000_000]);
    expect(row.base_item_reference).toBe('si_base');

    await applySubscriptionEvent(pg, event(customer, 'sub_p', { items: [baseItem, addonItem] }));
    row = await parent(org);
    expect([seconds(row.current_period_start), seconds(row.current_period_end)]).toEqual([1_800_000_000, 1_802_000_000]);

    // The allowance resolver reads exactly this window.
    const { rows } = await pg.query(
      `select starts_at, ends_at, basis from app.allowance_window($1, 'billing_period', 'month', to_timestamp(1800500000))`, [org.organizationId]);
    expect(rows[0].basis).toBe('subscription');
    expect(seconds(rows[0].ends_at)).toBe(1_802_000_000);
  });

  it('without an identifiable base Plan item, falls back deterministically and says so', async () => {
    const org = await newTenant('c3-period-fallback');
    const customer = await seedCustomer(org);
    const a = await standardPlan('addon');
    const b = await standardPlan('addon');
    const itemA = { itemReference: 'si_a', priceReference: a.priceReference, periodStart: 1_800_000_000, periodEnd: 1_803_000_000 };
    const itemB = { itemReference: 'si_b', priceReference: b.priceReference, periodStart: 1_800_000_000, periodEnd: 1_802_000_000 };
    for (const order of [[itemA, itemB], [itemB, itemA]]) {
      await applySubscriptionEvent(pg, event(customer, 'sub_f', { items: order }));
      const row = await parent(org);
      expect(Math.floor(new Date(row.current_period_end).getTime() / 1000)).toBe(1_802_000_000);
      expect(row.base_item_reference).toBeNull();
      expect(row.reconciliation_detail).toEqual([expect.objectContaining({ code: 'base_plan_item_unidentified' })]);
    }
  });
});

// ---------------------------------------------------------------------------
// service access does not read any of this
// ---------------------------------------------------------------------------

describe('service access still reads the subscription status and nothing else', () => {
  it('is unchanged by item count, reconciliation or checkout correlation', async () => {
    const org = await newTenant('c3-access');
    const customer = await seedCustomer(org);
    const planId = await createPlan(staff, { key: `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`, kind: 'plan', label: 'Access', description: '', billable: true });
    await recordPlanAssignment(staff, { organizationId: org.organizationId, planId, periodStart: '2000-01-01', periodEnd: '9999-12-31' });

    // Mismatching, legacy-unlinked, multi-item: still serviceable while the provider says active.
    await applySubscriptionEvent(pg, event(customer, 'sub_x', {
      checkoutCorrelation: randomUUID(),
      items: [{ priceReference: 'price_a' }, { priceReference: 'price_b' }, { priceReference: 'price_c' }],
    }));
    expect((await parent(org)).reconciliation_state).toBe('mismatch');
    expect(await getOrganizationServiceAccess(org.db, { organizationId: org.organizationId, environment: 'sandbox', operationalState: 'live' })).toMatchObject({ permitted: true, code: 'subscription_serviceable' });

    await applySubscriptionEvent(pg, event(customer, 'sub_x', { status: 'past_due', items: [{ priceReference: 'price_a' }] }));
    expect((await getOrganizationServiceAccess(org.db, { organizationId: org.organizationId, environment: 'sandbox', operationalState: 'live' })).permitted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// who may write what
// ---------------------------------------------------------------------------

describe('the provider cache has one writer', () => {
  it('is unwritable by a tenant or by platform staff, and unreadable across tenants', async () => {
    const org = await newTenant('c3-rls');
    const stranger = await newTenant('c3-rls-stranger');
    const customer = await seedCustomer(org);
    const base = await standardPlan('plan');
    const session = await seedSession(org, [base]);
    await applySubscriptionEvent(pg, event(customer, 'sub_r', { checkoutCorrelation: session, items: [{ itemReference: 'si_1', priceReference: base.priceReference }] }));
    const [row] = await items(org);

    // Reads: own business and staff only.
    expect((await org.db.from('organization_platform_subscription_items').select('id')).data).toHaveLength(1);
    expect((await stranger.db.from('organization_platform_subscription_items').select('id').eq('organization_id', org.organizationId)).data).toEqual([]);
    expect((await staff.from('organization_platform_subscription_items').select('id').eq('organization_id', org.organizationId)).data).toHaveLength(1);

    // Writes: nobody holds a grant, so each is refused as `permission denied`, not merely filtered.
    for (const client of [org.db, staff]) {
      for (const write of [
        client.from('organization_platform_subscription_items').update({ quantity: 99 }).eq('id', row.id),
        client.from('organization_platform_subscription_items').delete().eq('id', row.id),
        client.from('organization_platform_subscriptions').update({ status: 'canceled' }).eq('organization_id', org.organizationId),
        client.from('organization_platform_subscriptions').update({ reconciliation_state: 'matched' }).eq('organization_id', org.organizationId),
      ]) {
        const { error } = await write;
        expect(error?.code).toBe('42501');
      }
    }
    expect((await items(org))[0].quantity).toBe(1);

    // The checkout row's provider confirmation is the webhook's fact, not the billing manager's.
    const forged = await org.db.from('platform_billing_checkout_sessions').update({ reconciliation_state: 'matched' }).eq('id', session);
    expect(forged.error?.code).toBe('42501');
    const forgedConfirm = await org.db.from('platform_billing_checkout_sessions').update({ provider_confirmed_at: new Date().toISOString() }).eq('id', session);
    expect(forgedConfirm.error?.code).toBe('42501');
    const insertForged = await org.db.from('platform_billing_checkout_sessions').insert({
      organization_id: org.organizationId, environment: 'sandbox', requested_by: org.userId, reconciliation_state: 'matched',
    });
    expect(insertForged.error?.code).toBe('42501');
    // What checkout itself writes still works.
    const ok = await org.db.from('platform_billing_checkout_sessions').update({ provider_reference: 'cs_still_writable' }).eq('id', session);
    expect(ok.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// the C2 closeout migration's backfill, against real data
// ---------------------------------------------------------------------------

describe('20261108000003 attaches an existing negotiated mapping to the agreement that was in force', () => {
  it('runs its own backfill statement over old-shaped rows: right agreement, reference preserved, nothing overwritten', async () => {
    const sql = readFileSync(
      resolve(import.meta.dirname, '../../../../../supabase/migrations/20261108000003_a_negotiated_provider_price_belongs_to_its_agreement.sql'), 'utf8');
    const statement = /update public\.organization_plan_agreement_provider_prices m[\s\S]*?;/.exec(sql)?.[0];
    expect(statement, 'the backfill statement is still in the migration').toBeTruthy();

    const org = randomUUID(); const plan = randomUUID(); const otherPlan = randomUUID();
    const agreementA = randomUUID(); const agreementB = randomUUID(); const agreementOther = randomUUID();
    const mappingA = randomUUID(); const mappingB = randomUUID(); const mappingOrphan = randomUUID();

    await pg.query('begin');
    try {
      // The tables as they were before the migration, holding only the columns it reads.
      await pg.query(`create schema c3_scratch`);
      await pg.query(`create table c3_scratch.organization_plan_agreements (id uuid, organization_id uuid, plan_id uuid, effective_from timestamptz)`);
      await pg.query(`create table c3_scratch.organization_plan_agreement_provider_prices
        (id uuid, organization_id uuid, plan_id uuid, agreement_id uuid, provisioned_at timestamptz, price_reference text)`);
      await pg.query(
        `insert into c3_scratch.organization_plan_agreements values
           ($1,$4,$5,'2026-01-01'), ($2,$4,$5,'2026-06-01'), ($3,$4,$6,'2026-01-01')`,
        [agreementA, agreementB, agreementOther, org, plan, otherPlan]);
      await pg.query(
        `insert into c3_scratch.organization_plan_agreement_provider_prices (id, organization_id, plan_id, provisioned_at, price_reference) values
           ($1,$4,$5,'2026-02-01','price_old_a'),
           ($2,$4,$5,'2026-07-01','price_old_b'),
           ($3,$4,$5,'2025-01-01','price_before_any_agreement')`,
        [mappingA, mappingB, mappingOrphan, org, plan]);

      await pg.query(statement!.replaceAll('public.', 'c3_scratch.'));

      const { rows } = await pg.query(`select id, agreement_id, price_reference from c3_scratch.organization_plan_agreement_provider_prices order by price_reference`);
      const byRef = Object.fromEntries(rows.map((r) => [r.price_reference, r]));
      expect(byRef.price_old_a.agreement_id).toBe(agreementA); // the agreement in force when it was provisioned
      expect(byRef.price_old_b.agreement_id).toBe(agreementB); // a later agreement did not take the earlier mapping
      expect(byRef.price_before_any_agreement.agreement_id).toBeNull(); // nothing to attach to: the migration then deletes it, never guesses
      expect(rows).toHaveLength(3); // the backfill itself deleted nothing, and every historical reference survived
    } finally {
      await pg.query('rollback');
    }
  });
});
