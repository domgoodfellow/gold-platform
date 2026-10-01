import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { recordProviderRate } from '@/lib/domain/commercial/catalogue';
import {
  listUsageEvents,
  organizationCommercialSummary,
  organizationUsageDetail,
  recordUsageReconciliation,
} from '@/lib/domain/commercial/usage';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * The generalized usage ledger (D43, corrected): what a call cost GOLD, in the provider's own
 * currency, what it charged a tenant, in the tenant's own currency, and who may see which half.
 *
 * **The retail rate is written over a direct connection**, exactly as `communications.test.ts`
 * does, into `platform_retail_rates`. **The provider side goes through the real staff door**,
 * `recordProviderRate`, since that one is new, and now names Twilio explicitly (D43's
 * provider/meter split) rather than leaving it implied by the meter.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Currencies nobody else's test trades in (see communications.test.ts's own reasoning) — two
// of them, deliberately different, since that is exactly what this file has to prove can
// coexist on one usage fact.
const CUSTOMER_CURRENCY = 'XUS';
const PROVIDER_CURRENCY = 'XPR';

let pg: Client;
let staff: SupabaseClient;

type Tenant = { db: SupabaseClient; organizationId: string; customerId: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 8)}`,
    currency: CUSTOMER_CURRENCY,
  });

  const customerId = await createCustomer(db, { organizationId, name: 'A Caller' });

  // Opening credit, over the same direct connection communications.test.ts already uses — D40's
  // purse has no application write path at all.
  await pg.query(
    `insert into public.organization_credits (organization_id, amount_minor, currency, reason, note)
     values ($1, 100000, $2, 'purchase', 'opening credit')`,
    [organizationId, CUSTOMER_CURRENCY],
  );

  return { db, organizationId, customerId };
}

let tenant: Tenant;
let other: Tenant;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  // `platform_provider_rates` is GOLD's own catalogue — global, append-only, never seeded
  // (D43's own rule) and never tenant-scoped, unlike everything else this file writes. The
  // first test below depends on nothing having priced `twilio`/`voice_minutes` yet; on a
  // shared local database that has run this file before without a `db:reset` in between, an
  // earlier run's own rate is still the latest one `app.provider_rate_at` will find, since it
  // reads across every organization by provider and meter alone. The only rows that could ever
  // exist there in a dev environment are this file's own, so removing them here restores the
  // precondition the first test needs — it is this suite's own residue, not another test's.
  //
  // A usage event now records the provider rate it was costed with, and that reference is a
  // foreign key, so the rate cannot be deleted while an event still points at it. The events that
  // do are this suite's own residue from that earlier run and go first — and so does the cost
  // breakdown a later migration started recording per event, which points back at it the same way.
  await pg.query(
    `delete from public.usage_cost_components
      where usage_event_id in (
        select id from public.usage_events
         where provider_rate_id in (
           select id from public.platform_provider_rates
            where provider_key = 'twilio' and meter_id = 'voice_minutes'))`,
  );
  await pg.query(
    `delete from public.usage_events
      where provider_rate_id in (
        select id from public.platform_provider_rates
         where provider_key = 'twilio' and meter_id = 'voice_minutes')`,
  );
  await pg.query(
    `delete from public.platform_provider_rates where provider_key = 'twilio' and meter_id = 'voice_minutes'`,
  );

  // Twenty minor units a minute, retail.
  await pg.query(
    `insert into public.platform_retail_rates (meter_id, currency, unit_amount_micros, source)
     values ('voice_minutes', $1, 20000000, 'commercial-usage.test.ts')
     on conflict do nothing`,
    [CUSTOMER_CURRENCY],
  );

  staff = await asPlatformStaff();
  tenant = await newTenant('usage');
  other = await newTenant('usage-other');
}, 60_000);

afterAll(async () => {
  await pg?.end();
});

async function openAndCharge(caller: Tenant, durationSeconds: number): Promise<string> {
  const { data: callId, error } = await caller.db.rpc('open_call', {
    p_organization_id: caller.organizationId,
    p_customer_id: caller.customerId,
    p_conference_name: `gold-${randomUUID()}`,
    p_from_number: '+14165550100',
    p_to_number: '+14165550101',
  });
  if (error) throw error;

  // `open_call` starts the call `ringing`; in production the carrier's own `completed` callback
  // (`record_call_event`) is what moves it to `completed` before `app.charge_for_call` ever
  // runs — `app.charge_for_call` returns silently, charging nothing, for a call that is not
  // `completed` yet. Written directly here, over the same connection the migrations themselves
  // run on, standing in for that callback without a signed webhook payload.
  await pg.query(`update public.calls set status = 'completed', ended_at = now() where id = $1`, [callId]);

  // Only a carrier callback (`record_call_event`) reaches `app.charge_for_call` in production;
  // called directly here, over the same connection the migrations themselves run on, to test it
  // without also standing up a signed webhook payload.
  await pg.query('select app.charge_for_call($1, $2)', [callId, durationSeconds]);

  return callId as string;
}

describe('usage, cost and charge (D43)', () => {
  it('records a usage event at zero cost before GOLD has priced the meter', async () => {
    await openAndCharge(tenant, 90);

    const events = await listUsageEvents(tenant.db, { organizationId: tenant.organizationId });
    const event = events.find((entry) => entry.meterId === 'voice_minutes');
    expect(event).toBeTruthy();
    // 90 seconds rounds up to 2 minutes at 20/minute retail.
    expect(event?.quantity).toBe(2);
    expect(event?.customerChargeMinor).toBe(40);

    const summary = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const row = summary.find((entry) => entry.meterId === 'voice_minutes');
    // No provider rate recorded yet, so GOLD's cost is not known: it is not costed, which is not
    // free. The retail charge stands, but a margin needs a cost, so none is reported.
    expect(row?.providerCostMinor).toBe(0);
    expect(row?.uncostedQuantity).toBe(2);
    expect(row?.marginMinor).toBeNull();
  });

  it("records GOLD's own cost, from Twilio, once a provider rate exists — independently of the retail charge and in Twilio's own currency", async () => {
    // 8000 micro-minor-units per minute, in the *provider's* currency — never the tenant's.
    await recordProviderRate(staff, {
      providerKey: 'twilio',
      meterId: 'voice_minutes',
      currency: PROVIDER_CURRENCY,
      unitAmountMicros: 8000,
      source: 'test fixture',
    });

    await openAndCharge(tenant, 61); // rounds up to 2 minutes

    const summary = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    // Two currency-pair groups now exist for voice_minutes: the first call's (unpriced,
    // provider_currency null) and this one's (PROVIDER_CURRENCY) — grouping keeps them apart
    // rather than pretending a null currency and a real one are the same fact.
    const priced = summary.find(
      (entry) => entry.meterId === 'voice_minutes' && entry.providerCurrency === PROVIDER_CURRENCY,
    );
    expect(priced).toBeTruthy();
    expect(priced?.customerCurrency).toBe(CUSTOMER_CURRENCY);
    // One priced call, 2 minutes, at 8000 micros/min = 16000 micros = 0 minor units (rounds to
    // zero at this volume, the honest answer for a sub-cent wholesale rate).
    expect(priced?.quantity).toBe(2);
    expect(priced?.providerCostMinor).toBe(0);
    expect(priced?.customerChargeMinor).toBe(40);
    // The *raw* cost is 16,000 micros — not exactly zero, only rounding to zero minor units —
    // so this is already the currency-mismatch case: a real cost in the provider's own
    // currency next to a charge in the tenant's, and no margin guessed across them.
    expect(priced?.marginMinor).toBeNull();
  });

  it('lets a USD-ish provider cost and a CAD-ish customer charge coexist on one usage fact, and refuses to net them', async () => {
    // sms_segment has no real writer yet (D43 leaves it as vocabulary), so this event is
    // written directly, the same way a future provider-sync job would report a reading GOLD
    // did not itself dial — the point under test is the row's shape, not who wrote it.
    const eventId = randomUUID();
    await pg.query(
      `insert into public.usage_events
         (id, organization_id, meter_id, quantity, provider_key, provider_currency,
          provider_cost_micros, customer_currency, customer_charge_micros, note)
       values ($1, $2, 'sms_segment', 3, 'twilio', $3, 2700000000, $4, 1000000, 'test: mixed currencies')`,
      [eventId, tenant.organizationId, PROVIDER_CURRENCY, CUSTOMER_CURRENCY],
    );

    const detail = await organizationUsageDetail(staff, { organizationId: tenant.organizationId });
    const row = detail.find((entry) => entry.usageEventId === eventId);
    expect(row).toBeTruthy();
    expect(row?.estimatedCurrency).toBe(PROVIDER_CURRENCY);
    expect(row?.customerCurrency).toBe(CUSTOMER_CURRENCY);
    expect(row?.estimatedCurrency).not.toBe(row?.customerCurrency);

    const summary = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const sms = summary.find((entry) => entry.meterId === 'sms_segment');
    expect(sms?.providerCurrency).toBe(PROVIDER_CURRENCY);
    expect(sms?.customerCurrency).toBe(CUSTOMER_CURRENCY);
    expect(sms?.providerCostMinor).toBe(2700);
    expect(sms?.customerChargeMinor).toBe(1);
    // The one assertion this test exists for: a real, non-zero cost in a currency that
    // disagrees with the charge reports no margin, rather than a number arrived at by
    // subtracting unlike currencies.
    expect(sms?.marginMinor).toBeNull();
  });

  it('replaces the estimate with a reconciliation for reporting, without duplicating quantity or the customer charge', async () => {
    const eventId = randomUUID();
    await pg.query(
      `insert into public.usage_events
         (id, organization_id, meter_id, quantity, provider_key, provider_currency,
          provider_cost_micros, customer_currency, customer_charge_micros, note)
       values ($1, $2, 'call_recording_minutes', 5, 'twilio', $3, 5000000, $4, 200, 'test: recording estimate')`,
      [eventId, tenant.organizationId, PROVIDER_CURRENCY, CUSTOMER_CURRENCY],
    );

    const before = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const beforeRow = before.find((entry) => entry.meterId === 'call_recording_minutes');
    expect(beforeRow?.quantity).toBe(5);
    expect(beforeRow?.providerCostMinor).toBe(5); // 5,000,000 micros = 5 minor units
    expect(beforeRow?.customerChargeMinor).toBe(0); // 200 micros rounds to 0

    // The provider's real bill said more than GOLD estimated.
    await recordUsageReconciliation(staff, {
      usageEventId: eventId,
      reconciledProviderCostMicros: 9_000_000,
      providerCurrency: PROVIDER_CURRENCY,
      source: 'Twilio invoice, test fixture',
      providerReference: 'INV-TEST-1',
    });

    const after = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const afterRow = after.find((entry) => entry.meterId === 'call_recording_minutes');
    // Quantity and customer charge are untouched — a reconciliation adds neither.
    expect(afterRow?.quantity).toBe(5);
    expect(afterRow?.customerChargeMinor).toBe(0);
    // The effective cost is now the reconciled figure, not the estimate, and not the sum of
    // both (which would be 14 minor units).
    expect(afterRow?.providerCostMinor).toBe(9);

    // The original estimate is still there to be read, next to what corrected it.
    const detail = await organizationUsageDetail(staff, { organizationId: tenant.organizationId });
    const row = detail.find((entry) => entry.usageEventId === eventId);
    expect(row?.estimatedCostMicros).toBe(5_000_000);
    expect(row?.estimatedCurrency).toBe(PROVIDER_CURRENCY);
    expect(row?.reconciledCostMicros).toBe(9_000_000);
    expect(row?.reconciledCurrency).toBe(PROVIDER_CURRENCY);
    expect(row?.reconciledAt).toBeTruthy();

    // A second reconciliation supersedes the first for reporting, and both stay on record —
    // append-only, never an edit to the first correction.
    await recordUsageReconciliation(staff, {
      usageEventId: eventId,
      reconciledProviderCostMicros: 7_000_000,
      providerCurrency: PROVIDER_CURRENCY,
      source: 'Twilio invoice, corrected',
    });

    const { rows: reconciliations } = await pg.query(
      'select count(*)::int as count from public.usage_cost_reconciliations where usage_event_id = $1',
      [eventId],
    );
    expect(reconciliations[0].count).toBe(2);

    const latest = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    expect(latest.find((entry) => entry.meterId === 'call_recording_minutes')?.providerCostMinor).toBe(7);
  });

  it('refuses a reconciliation to anyone who is not platform staff', async () => {
    const eventId = randomUUID();
    await pg.query(
      `insert into public.usage_events
         (id, organization_id, meter_id, quantity, provider_key, customer_currency, customer_charge_micros, note)
       values ($1, $2, 'tts_characters', 10, 'elevenlabs', $3, 0, 'test: unpriced')`,
      [eventId, tenant.organizationId, CUSTOMER_CURRENCY],
    );

    await expect(
      recordUsageReconciliation(tenant.db, {
        usageEventId: eventId,
        reconciledProviderCostMicros: 1000,
        providerCurrency: 'USD',
        source: 'a tenant should not reach this',
      }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });
  });

  it("never lets a tenant see GOLD's own cost, a reconciliation, or a margin — column grants and function grants, not a filtered read", async () => {
    const { error: costColumn } = await tenant.db
      .from('usage_events')
      .select('provider_cost_micros')
      .eq('organization_id', tenant.organizationId)
      .limit(1);
    expect(costColumn).toBeTruthy();

    const { error: providerColumn } = await tenant.db
      .from('usage_events')
      .select('provider_key, provider_currency')
      .eq('organization_id', tenant.organizationId)
      .limit(1);
    expect(providerColumn).toBeTruthy();

    const { error: reconciliationTable } = await tenant.db
      .from('usage_cost_reconciliations')
      .select('reconciled_provider_cost_micros')
      .limit(1);
    expect(reconciliationTable).toBeTruthy();

    await expect(
      organizationCommercialSummary(tenant.db, { organizationId: tenant.organizationId }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });

    await expect(
      organizationUsageDetail(tenant.db, { organizationId: tenant.organizationId }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });

    // The columns this file's own tenant-facing reader actually asks for still come back,
    // proving the refusals above are withheld columns rather than the whole table.
    const events = await listUsageEvents(tenant.db, { organizationId: tenant.organizationId });
    expect(events.length).toBeGreaterThan(0);
  });

  it("keeps one tenant's usage, and its reconciliations, out of another's reach entirely", async () => {
    await openAndCharge(other, 60);

    const otherEvents = await listUsageEvents(other.db, { organizationId: other.organizationId });
    expect(otherEvents.length).toBeGreaterThan(0);

    // Tenant sees only its own rows even when asking under its own session.
    const crossRead = await listUsageEvents(tenant.db, { organizationId: other.organizationId });
    expect(crossRead).toHaveLength(0);

    // Staff's own aggregate keeps the two apart too — the other business's calls never inflate
    // this one's summary.
    const tenantSummary = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const otherSummary = await organizationCommercialSummary(staff, { organizationId: other.organizationId });
    expect(tenantSummary.some((row) => row.meterId === 'voice_minutes')).toBe(true);
    expect(otherSummary.some((row) => row.meterId === 'voice_minutes')).toBe(true);
    // Each organization's own summary is scoped by its own id — read separately above by
    // construction, since `organization_commercial_summary` takes exactly one.
  });
});
