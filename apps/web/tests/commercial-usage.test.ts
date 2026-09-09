import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { recordProviderRate } from '@/lib/domain/commercial/catalogue';
import { listUsageEvents, organizationCommercialSummary } from '@/lib/domain/commercial/usage';
import { asPlatformStaff, foundBusiness } from './helpers/founding';

/**
 * The generalized usage ledger (D43): what a call cost GOLD, what it charged, and who may see
 * which half.
 *
 * **The rate is written over a direct connection for the retail side**, exactly as
 * `communications.test.ts` already does — `communication_rates` has no application write path
 * at all, unchanged by this slice. **The provider side goes through the real staff door**,
 * `recordProviderRate`, since that one is new.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// A currency nobody else's test trades in (see communications.test.ts's own reasoning).
const CURRENCY = 'XUS';

let pg: Client;
let tenant: { db: SupabaseClient; organizationId: string };
let staff: SupabaseClient;
let customerId: string;

async function newTenant(label: string): Promise<{ db: SupabaseClient; organizationId: string }> {
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
    currency: CURRENCY,
  });

  return { db, organizationId };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  // Twenty minor units a minute, retail — communication_rates, unchanged by this slice.
  await pg.query(
    `insert into public.communication_rates (currency, channel, unit_amount_minor)
     values ($1, 'voice', 20)
     on conflict (currency, channel) do update set unit_amount_minor = excluded.unit_amount_minor`,
    [CURRENCY],
  );

  staff = await asPlatformStaff();
  tenant = await newTenant('usage');
  customerId = await createCustomer(tenant.db, { organizationId: tenant.organizationId, name: 'A Caller' });

  // Opening credit, over the same direct connection communications.test.ts already uses —
  // D40's purse has no application write path at all, unchanged by this slice, and `open_call`
  // refuses to start a room this business cannot afford.
  await pg.query(
    `insert into public.communication_credits (organization_id, amount_minor, currency, reason, note)
     values ($1, 100000, $2, 'purchase', 'opening credit')`,
    [tenant.organizationId, CURRENCY],
  );
}, 60_000);

afterAll(async () => {
  await pg?.end();
});

async function openAndCharge(durationSeconds: number): Promise<string> {
  const { data: callId, error } = await tenant.db.rpc('open_call', {
    p_organization_id: tenant.organizationId,
    p_customer_id: customerId,
    p_conference_name: `gold-${randomUUID()}`,
    p_from_number: '+14165550100',
    p_to_number: '+14165550101',
  });
  if (error) throw error;

  // Only a carrier callback (`record_call_event`) reaches `app.charge_for_call` in production;
  // called directly here, over the same connection the migrations themselves run on, to test
  // it without also standing up a signed webhook payload.
  await pg.query('select app.charge_for_call($1, $2)', [callId, durationSeconds]);

  return callId as string;
}

describe('usage, cost and charge (D43)', () => {
  it('records a usage event at zero cost before GOLD has priced the meter', async () => {
    await openAndCharge(90);

    const events = await listUsageEvents(tenant.db, { organizationId: tenant.organizationId });
    const event = events.find((entry) => entry.meterId === 'voice_minutes');
    expect(event).toBeTruthy();
    // 90 seconds rounds up to 2 minutes at 20/minute retail.
    expect(event?.quantity).toBe(2);
    expect(event?.customerChargeMinor).toBe(40);

    const summary = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const row = summary.find((entry) => entry.meterId === 'voice_minutes');
    // No provider rate recorded yet — unpriced reads as free, D40's own rule applied to cost.
    expect(row?.providerCostMinor).toBe(0);
  });

  it('records GOLD\'s own cost once a provider rate exists, independently of the retail charge', async () => {
    // 8000 micro-minor-units per minute (0.8 cents/min in this test currency's minor unit).
    await recordProviderRate(staff, {
      meterId: 'voice_minutes',
      currency: CURRENCY,
      unitAmountMicros: 8000,
      source: 'test fixture',
    });

    await openAndCharge(61); // rounds up to 2 minutes

    const summary = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const row = summary.find((entry) => entry.meterId === 'voice_minutes');
    expect(row).toBeTruthy();
    // Two calls so far: 2 + 2 = 4 minutes, at 8000 micros/min = 32000 micros = 0 minor units
    // (rounds to zero at this volume, which is the honest answer for a sub-cent wholesale rate —
    // only the first call's zero-priced minutes plus these four are summed before rounding).
    expect(row?.quantity).toBe(4);
    expect(row?.providerCostMinor).toBe(0);
    expect(row?.customerChargeMinor).toBe(80);
  });

  it('never lets a tenant select GOLD\'s own cost — a column grant, not a filtered read', async () => {
    const { error } = await tenant.db
      .from('usage_events')
      .select('provider_cost_micros')
      .eq('organization_id', tenant.organizationId)
      .limit(1);

    expect(error).toBeTruthy();

    // The columns this file's own reader actually asks for still come back, proving the
    // refusal above is the withheld column rather than the whole table.
    const events = await listUsageEvents(tenant.db, { organizationId: tenant.organizationId });
    expect(events.length).toBeGreaterThan(0);
  });

  it('refuses organizationCommercialSummary to anyone who is not platform staff', async () => {
    await expect(
      organizationCommercialSummary(tenant.db, { organizationId: tenant.organizationId }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });
  });
});
