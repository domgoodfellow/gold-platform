import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordProviderRate, recordRetailRate } from '@/lib/domain/commercial/catalogue';
import { organizationCommercialSummary, organizationUsageDetail, recordUsageReconciliation } from '@/lib/domain/commercial/usage';
import { createCustomer } from '@/lib/domain/customers/customers';
import { recordCall } from '@/lib/domain/reception/calls';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * One economics model: meter -> usage event -> provider fulfilment and cost -> retail rate.
 *
 * What is proved here: a retail rate resolves deterministically by meter, currency and moment; a
 * usage event cannot name another business's binding or resource; a real call can be traced from
 * the business to the capability, the provider fulfilment, the cost and the retail rate; what
 * usage cost GOLD and what it charged are facts written once and never recomputed against
 * today's rates; and the only thing that writes a usage event is `app.record_usage`.
 *
 * Every price here is in a currency invented for this run, because a rate has no tenant to scope
 * it by and this suite shares a database with others.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function code(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = () => letters[Math.floor(Math.random() * 26)];
  return `X${pick()}${pick()}`;
}

const CURRENCY = code();
const DAY = 86_400_000;

type Tenant = { db: SupabaseClient; organizationId: string; customerId: string };

const createdOrganizations: string[] = [];

let pg: Client;
let staff: SupabaseClient;
let tenant: Tenant;
let other: Tenant;
let accountId: string;
let bindingId: string;
let resourceId: string;
let otherBindingId: string;
let otherResourceId: string;
const NUMBER = '+14165550177';
const OTHER_NUMBER = '+14165550188';

const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: CURRENCY });
  const customerId = await createCustomer(db, { organizationId, name: 'A Caller' });
  createdOrganizations.push(organizationId);
  return { db, organizationId, customerId };
}

async function fulfilment(organizationId: string, number: string, accountForBinding: string | null) {
  const { rows: binding } = await pg.query(
    `insert into public.organization_provider_bindings
       (organization_id, provider_key, external_account_id, status, provider_account_id)
     values ($1, 'twilio', $2, 'active', $3) returning id`,
    [organizationId, `AC${randomUUID().slice(0, 8)}`, accountForBinding],
  );
  const { rows: resource } = await pg.query(
    `insert into public.organization_provider_resources
       (organization_id, binding_id, resource_type, external_id, status)
     values ($1, $2, 'twilio_phone_number', $3, 'active') returning id`,
    [organizationId, binding[0].id, `PN${randomUUID().slice(0, 8)}`],
  );
  await pg.query(
    `insert into public.phone_numbers
       (organization_id, provider_resource_id, e164, lifecycle, purpose, inbound_enabled, outbound_enabled, health)
     values ($1, $2, $3, 'active', 'general', true, true, 'healthy')`,
    [organizationId, resource[0].id, number],
  );
  return { bindingId: binding[0].id as string, resourceId: resource[0].id as string };
}

async function retailAt(meter: string, moment: string) {
  const { rows } = await pg.query('select * from app.retail_rate_at($1, $2, $3::timestamptz)', [meter, CURRENCY, moment]);
  return rows[0] as { id: string; unit_amount_micros: string } | undefined;
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();

  // Retail history for voice in this run's currency: two past prices, one scheduled, and a draft
  // that must never apply. Effective dates are explicit so the resolution is what is tested.
  const rates: Array<[string, number, string, number]> = [
    ['voice_minutes', 5_000_000, 'approved', -2 * DAY],
    ['voice_minutes', 7_000_000, 'approved', -1 * DAY],
    ['voice_minutes', 9_000_000, 'approved', +1 * DAY],
    ['voice_minutes', 99_000_000, 'draft', -12 * 3_600_000],
    ['sms_segment', 6_000_000, 'approved', -1 * DAY],
    // A price that really is nothing: distinct from having no price at all.
    ['call_recording_minutes', 0, 'approved', -1 * DAY],
  ];
  for (const [meter, micros, state, offset] of rates) {
    await pg.query(
      `insert into public.platform_retail_rates (meter_id, currency, unit_amount_micros, approval_state, effective_from, source)
       values ($1, $2, $3, $4, $5::timestamptz, 'usage-economics.test.ts')`,
      [meter, CURRENCY, micros, state, at(offset)],
    );
  }

  const { rows: account } = await pg.query(
    `insert into public.platform_provider_accounts (provider_key, label, credential_kind)
     values ('twilio', $1, 'account_credential') returning id`,
    [`usage-economics ${randomUUID().slice(0, 6)}`],
  );
  accountId = account[0].id;

  [tenant, other] = await Promise.all([newTenant('econ'), newTenant('econ-other')]);
  ({ bindingId, resourceId } = await fulfilment(tenant.organizationId, NUMBER, accountId));
  ({ bindingId: otherBindingId, resourceId: otherResourceId } = await fulfilment(other.organizationId, OTHER_NUMBER, null));
  await pg.query(
    `insert into public.organization_credits (organization_id, amount_minor, currency, reason) values ($1, 1000000, $2, 'purchase')`,
    [tenant.organizationId, CURRENCY],
  );
}, 120_000);

afterAll(async () => {
  try {
    const orgs = createdOrganizations;
    await pg.query(`delete from public.usage_cost_component_adjustments where organization_id = any($1)`, [orgs]);
    await pg.query(`delete from public.usage_cost_components where organization_id = any($1)`, [orgs]);
    await pg.query('delete from public.usage_events where organization_id = any($1)', [orgs]);
    await pg.query('delete from public.phone_numbers where organization_id = any($1)', [orgs]);
    await pg.query('delete from public.organization_provider_resources where organization_id = any($1)', [orgs]);
    await pg.query('delete from public.organization_provider_bindings where organization_id = any($1)', [orgs]);
    await pg.query('delete from public.platform_provider_accounts where id = $1', [accountId]);
    await pg.query(`delete from public.platform_retail_rates where source = 'usage-economics.test.ts'`);
    await pg.query(
      `delete from public.platform_provider_rates
        where source = 'usage-economics.test.ts'
           or source like 'components-%'
           or source like 'history-%'`,
    );
  } finally {
    await pg.end();
  }
});

describe('provider cost components', () => {
  it('records several independently-rated components against one commercial event idempotently', async () => {
    const source = `components-${randomUUID()}`;
    for (const [costMeter, amount] of [
      ['telephony.pstn.outbound.minute', 1_400_000],
      ['telephony.client.minute', 400_000],
      ['telephony.conference.participant_minute', 250_000],
    ] as const) {
      await pg.query(
        `insert into public.platform_provider_rates
           (provider_key, meter_id, cost_meter_key, currency, unit_amount_micros,
            approval_state, effective_from, source)
         values ('twilio', 'voice_minutes', $1, 'USD', $2, 'approved', now() - interval '1 day', $3)`,
        [costMeter, amount, source],
      );
    }
    const event = (await pg.query(
      `select app.record_usage($1, 'voice_minutes', 2, 'twilio', now(), null, $2, $3, $4, 'multi') as id`,
      [tenant.organizationId, bindingId, resourceId, source],
    )).rows[0].id as string;
    await pg.query(`select app.identify_usage_source($1, 'communications.call', $2)`, [event, source]);
    await pg.query(`select app.record_usage_cost_component($1, 'pstn', 'twilio', 'telephony.pstn.outbound.minute', 2, 'minute', $2, $3, 'CA', 'outbound')`, [event, bindingId, resourceId]);
    await pg.query(`select app.record_usage_cost_component($1, 'client', 'twilio', 'telephony.client.minute', 2, 'minute', $2, $3)`, [event, bindingId, resourceId]);
    await pg.query(`select app.record_usage_cost_component($1, 'conference', 'twilio', 'telephony.conference.participant_minute', 4, 'participant_minute', $2, $3)`, [event, bindingId, resourceId]);
    await pg.query(`select app.record_usage_cost_component($1, 'pstn', 'twilio', 'telephony.pstn.outbound.minute', 2, 'minute', $2, $3, 'CA', 'outbound')`, [event, bindingId, resourceId]);
    const { rows } = await pg.query(`select component_key, cost_state, native_currency from public.usage_cost_components where usage_event_id = $1 order by component_key`, [event]);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.component_key)).toEqual(['client', 'conference', 'pstn']);
    expect(rows.every((row) => row.cost_state === 'estimated' && row.native_currency === 'USD')).toBe(true);
  });

  it('keeps unknown distinct from zero when no rate or FX matches', async () => {
    const reference = `unknown-${randomUUID()}`;
    const event = (await pg.query(
      `select app.record_usage($1, 'sms_segment', 1, 'twilio', now(), null, $2, $3, $4, '') as id`,
      [tenant.organizationId, bindingId, resourceId, reference],
    )).rows[0].id as string;
    await pg.query(`select app.record_usage_cost_component($1, 'carrier', 'twilio', 'messaging.carrier_fee', 1, 'message', $2, $3)`, [event, bindingId, resourceId]);
    const { rows } = await pg.query(`select cost_state, native_cost_micros, unknown_reason from public.usage_cost_components where usage_event_id = $1`, [event]);
    expect(rows[0]).toMatchObject({ cost_state: 'unknown', native_cost_micros: null });
    expect(rows[0].unknown_reason).toContain('No current provider rate');
  });

  it('retains the historical rate version and supports another provider on the same event', async () => {
    const source = `history-${randomUUID()}`;
    const first = (await pg.query(
      `insert into public.platform_provider_rates
         (provider_key, meter_id, cost_meter_key, currency, unit_amount_micros, approval_state, effective_from, source)
       values ('twilio', 'voice_minutes', 'telephony.client.minute', 'USD', 1000000, 'approved', now() - interval '2 days', $1)
       returning id`, [source])).rows[0].id;
    await pg.query(
      `insert into public.platform_provider_rates
         (provider_key, meter_id, cost_meter_key, currency, unit_amount_micros, approval_state, effective_from, source)
       values ('twilio', 'voice_minutes', 'telephony.client.minute', 'USD', 2000000, 'approved', now(), $1)`, [source]);
    const event = (await pg.query(
      `select app.record_usage($1, 'voice_minutes', 1, 'twilio', now() - interval '36 hours', null, $2, $3, $4, '') as id`,
      [tenant.organizationId, bindingId, resourceId, source],
    )).rows[0].id as string;
    await pg.query(`select app.record_usage_cost_component($1, 'client', 'twilio', 'telephony.client.minute', 1, 'minute', $2, $3)`, [event, bindingId, resourceId]);
    await pg.query(`select app.record_usage_cost_component($1, 'stt', 'deepgram', 'messaging.carrier_fee', 1, 'message')`, [event]);
    const { rows } = await pg.query(`select provider_key, provider_rate_id, cost_state from public.usage_cost_components where usage_event_id = $1 order by provider_key`, [event]);
    expect(rows.find((row) => row.provider_key === 'twilio')?.provider_rate_id).toBe(first);
    expect(rows.find((row) => row.provider_key === 'deepgram')?.cost_state).toBe('unknown');
  });

  it('records one active number-month once when a monthly job retries', async () => {
    const number = (await pg.query(`select id from public.phone_numbers where organization_id = $1 and e164 = $2`, [tenant.organizationId, NUMBER])).rows[0].id;
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const first = await staff.rpc('record_phone_number_month', { p_phone_number_id: number, p_billing_period: month });
    const second = await staff.rpc('record_phone_number_month', { p_phone_number_id: number, p_billing_period: month });
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);
    const { rows } = await pg.query(`select count(*)::int as count from public.usage_events where organization_id = $1 and meter_id = 'phone_numbers' and billing_period = $2`, [tenant.organizationId, month]);
    expect(rows[0].count).toBe(1);
  });

  it('does not expose wholesale components to an ordinary tenant', async () => {
    const result = await tenant.db.from('usage_cost_components').select('id').limit(1);
    expect(result.data ?? []).toEqual([]);
  });
});

describe('retail rate resolution', () => {
  it('resolves the rate in force now: the latest approved one that has started', async () => {
    expect(Number((await retailAt('voice_minutes', at(0)))?.unit_amount_micros)).toBe(7_000_000);
  });

  it('resolves a historical moment to the rate that applied then', async () => {
    expect(Number((await retailAt('voice_minutes', at(-36 * 3_600_000)))?.unit_amount_micros)).toBe(5_000_000);
  });

  it('does not apply a scheduled rate before it starts, and does once it has', async () => {
    expect(Number((await retailAt('voice_minutes', at(0)))?.unit_amount_micros)).not.toBe(9_000_000);
    expect(Number((await retailAt('voice_minutes', at(2 * DAY)))?.unit_amount_micros)).toBe(9_000_000);
  });

  it('never applies a draft, even the latest one that has started', async () => {
    const found = await retailAt('voice_minutes', at(0));
    expect(Number(found?.unit_amount_micros)).not.toBe(99_000_000);
  });

  it('answers nothing for a moment before any price, and nothing for a meter or currency with none', async () => {
    expect(await retailAt('voice_minutes', at(-3 * DAY))).toBeUndefined();
    expect(await retailAt('email_send', at(0))).toBeUndefined();
    const { rows } = await pg.query(`select * from app.retail_rate_at('voice_minutes', 'XZZ', now())`);
    expect(rows).toEqual([]);
  });

  it('reads the currency without regard to case', async () => {
    const { rows } = await pg.query(`select * from app.retail_rate_at('voice_minutes', $1, now())`, [CURRENCY.toLowerCase()]);
    expect(rows).toHaveLength(1);
  });

  it('cannot hold two rates for one meter, currency and moment, whatever their state', async () => {
    // In a currency of its own, so the row it leaves cannot change what the history above resolves to.
    const scratch = code();
    const moment = at(-5 * DAY);
    const insert = (state: string) =>
      pg.query(
        `insert into public.platform_retail_rates (meter_id, currency, unit_amount_micros, approval_state, effective_from, source)
         values ('voice_minutes', $1, 1, $2, $3::timestamptz, 'usage-economics.test.ts')`,
        [scratch, state, moment],
      );
    await insert('approved');
    await expect(insert('approved')).rejects.toMatchObject({ code: '23505' });
    await expect(insert('draft')).rejects.toMatchObject({ code: '23505' });
  });

  it('is offered to a member as the effective rate per meter, and to nobody who belongs to no business', async () => {
    const member = await tenant.db.rpc('effective_retail_rates', { p_currency: CURRENCY });
    expect(member.error).toBeNull();
    const byMeter = Object.fromEntries(((member.data ?? []) as Array<{ meter_id: string; unit_amount_micros: number }>).map((row) => [row.meter_id, Number(row.unit_amount_micros)]));
    expect(byMeter.voice_minutes).toBe(7_000_000);
    expect(byMeter.sms_segment).toBe(6_000_000);
    expect(byMeter.email_send).toBeUndefined();

    const visitor = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    await visitor.auth.signInAnonymously();
    const none = await visitor.rpc('effective_retail_rates', { p_currency: CURRENCY });
    expect(none.data).toEqual([]);
  });

  it('lets staff schedule a price ahead, and refuses one dated in the past or from anybody else', async () => {
    const ahead = await recordRetailRate(staff, {
      meterId: 'email_send',
      currency: CURRENCY,
      unitAmountMicros: 1_000_000,
      source: 'usage-economics.test.ts',
      effectiveFrom: at(3 * DAY),
    });
    expect(ahead).toBeTruthy();
    expect(await retailAt('email_send', at(0))).toBeUndefined();
    expect(Number((await retailAt('email_send', at(4 * DAY)))?.unit_amount_micros)).toBe(1_000_000);

    await expect(
      recordRetailRate(staff, {
        meterId: 'email_send', currency: CURRENCY, unitAmountMicros: 1, source: 'usage-economics.test.ts',
        effectiveFrom: at(-DAY),
      }),
    ).rejects.toThrow(/past/);

    await expect(
      recordRetailRate(tenant.db, {
        meterId: 'email_send', currency: CURRENCY, unitAmountMicros: 1, source: 'usage-economics.test.ts',
      }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });
  });
});

describe('spending is a question about a meter', () => {
  it('refuses a meter with a retail rate that the balance does not cover, and allows one with no rate', async () => {
    const empty = await newTenant('econ-empty');
    const ask = async (organizationId: string, meter: string, units: number) =>
      (await pg.query('select app.may_spend_on($1, $2, $3) as ok', [organizationId, meter, units])).rows[0].ok as boolean;

    expect(await ask(empty.organizationId, 'sms_segment', 1)).toBe(false); // priced, nothing bought
    expect(await ask(empty.organizationId, 'ai_tokens_input', 1)).toBe(true); // no price, nothing to draw

    await pg.query(`insert into public.organization_credits (organization_id, amount_minor, currency, reason) values ($1, 11, $2, 'purchase')`, [empty.organizationId, CURRENCY]);
    expect(await ask(empty.organizationId, 'sms_segment', 1)).toBe(true); // 11 >= 6
    expect(await ask(empty.organizationId, 'sms_segment', 2)).toBe(false); // 11 < 12
  });
});

describe('the recording door', () => {
  it('prices usage at the moment it occurred, and records the rate rows it used', async () => {
    const now = await pg.query(`select app.record_usage($1, 'sms_segment', 2, 'twilio', now(), null, null, null, $2, 'test') as id`, [tenant.organizationId, `now-${randomUUID()}`]);
    const { rows } = await pg.query('select * from public.usage_events where id = $1', [now.rows[0].id]);
    expect(Number(rows[0].customer_charge_micros)).toBe(12_000_000);
    expect(rows[0].customer_currency).toBe(CURRENCY);
    const rate = await retailAt('sms_segment', new Date().toISOString());
    expect(rows[0].retail_rate_id).toBe(rate?.id);
  });

  it('charges nothing where no rate had started, and says so with no rate row', async () => {
    const { rows: made } = await pg.query(
      `select app.record_usage($1, 'voice_minutes', 1, 'twilio', $2::timestamptz, null, null, null, $3, 'before any price') as id`,
      [tenant.organizationId, at(-3 * DAY), `early-${randomUUID()}`],
    );
    const { rows } = await pg.query('select customer_charge_micros, retail_rate_id from public.usage_events where id = $1', [made[0].id]);
    expect(Number(rows[0].customer_charge_micros)).toBe(0);
    expect(rows[0].retail_rate_id).toBeNull();
  });

  it('is idempotent on a reference: the same report is one fact', async () => {
    const reference = `same-${randomUUID()}`;
    const call = () =>
      pg.query(`select app.record_usage($1, 'sms_segment', 1, 'twilio', now(), null, null, null, $2, '') as id`, [tenant.organizationId, reference]);
    const first = (await call()).rows[0].id;
    const second = (await call()).rows[0].id;
    expect(second).toBe(first);
    const { rows } = await pg.query('select count(*)::int as n from public.usage_events where organization_id = $1 and reference = $2', [tenant.organizationId, reference]);
    expect(rows[0].n).toBe(1);
  });

  it.each([
    ['a quantity of nothing', `select app.record_usage($1, 'sms_segment', 0, 'twilio')`, '22022|22023'],
    ['usage in the future', `select app.record_usage($1, 'sms_segment', 1, 'twilio', now() + interval '1 hour')`, '22023'],
    ['a meter that does not exist', `select app.record_usage($1, 'no_such_meter', 1, 'twilio')`, '23503'],
  ])('refuses %s', async (_label, statement, codes) => {
    await expect(pg.query(statement, [tenant.organizationId])).rejects.toSatisfy((error: { code?: string }) => codes.split('|').includes(error.code ?? ''));
  });

  it('refuses a capability that its meter does not measure', async () => {
    const { rows } = await pg.query(
      `select f.id from public.platform_catalog_features f join public.platform_catalog_modules m on m.id = f.module_id
        where m.key = 'voice' and f.key = 'outbound_calling'`,
    );
    await expect(
      pg.query(`select app.record_usage($1, 'email_send', 1, 'resend', now(), $2)`, [tenant.organizationId, rows[0].id]),
    ).rejects.toMatchObject({ code: '22023' });
  });

  it('says per event how it was fulfilled, and refuses a fulfilment that contradicts the binding', async () => {
    // Served from GOLD's own account: nothing of the business's to name, and naming a binding
    // would be false provenance.
    await expect(
      pg.query(`select app.record_usage($1, 'ai_tokens_input', 10, 'anthropic', now(), null, $2, null, null, '', 'platform_account')`, [tenant.organizationId, bindingId]),
    ).rejects.toMatchObject({ code: '22023' });
    // Said to be through a binding, but none named.
    await expect(
      pg.query(`select app.record_usage($1, 'sms_segment', 1, 'twilio', now(), null, null, null, null, '', 'organization_binding')`, [tenant.organizationId]),
    ).rejects.toMatchObject({ code: '22023' });

    const state = async (statement: string, params: unknown[]) => {
      const made = await pg.query(statement, params);
      const { rows } = await pg.query(
        'select fulfilled_through, provider_binding_id, provider_resource_id from public.usage_events where id = $1', [made.rows[0].id]);
      return rows[0];
    };

    // Not applicable: GOLD's own account served it.
    expect(await state(`select app.record_usage($1, 'ai_tokens_input', 10, 'anthropic', now(), null, null, null, null, '', 'platform_account') as id`, [tenant.organizationId]))
      .toEqual({ fulfilled_through: 'platform_account', provider_binding_id: null, provider_resource_id: null });
    // Through the business's own binding: named, and said so without being told.
    expect(await state(`select app.record_usage($1, 'sms_segment', 1, 'twilio', now(), null, $2) as id`, [tenant.organizationId, bindingId]))
      .toEqual({ fulfilled_through: 'organization_binding', provider_binding_id: bindingId, provider_resource_id: null });
    // Not recorded: the reporter could not say, which is a gap and not an absence.
    expect(await state(`select app.record_usage($1, 'sms_segment', 1, 'twilio') as id`, [tenant.organizationId]))
      .toEqual({ fulfilled_through: 'unrecorded', provider_binding_id: null, provider_resource_id: null });
  });
});

describe('tenant integrity of usage provenance', () => {
  it('refuses another business’s binding through the door', async () => {
    await expect(
      pg.query(`select app.record_usage($1, 'sms_segment', 1, 'twilio', now(), null, $2)`, [tenant.organizationId, otherBindingId]),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('refuses another business’s binding, resource, account or wrong rates in the table itself, with no function in the way', async () => {
    const insert = (columns: string, values: unknown[]) =>
      pg.query(
        `insert into public.usage_events (organization_id, meter_id, quantity, provider_key, customer_currency, ${columns})
         values ($1, 'sms_segment', 1, 'twilio', $2, ${values.map((_, i) => `$${i + 3}`).join(', ')})`,
        [tenant.organizationId, CURRENCY, ...values],
      );

    // Org A's usage naming org B's binding.
    await expect(insert('provider_binding_id, fulfilled_through', [otherBindingId, 'organization_binding'])).rejects.toMatchObject({ code: '23503', constraint: 'usage_events_binding_same_org_and_provider' });
    // Org A's binding with org B's resource.
    await expect(insert('provider_binding_id, provider_resource_id, fulfilled_through', [bindingId, otherResourceId, 'organization_binding'])).rejects.toMatchObject({ code: '23503', constraint: 'usage_events_resource_same_org_and_binding' });
    // A binding named for usage that says it was not fulfilled through one.
    await expect(insert('provider_binding_id, fulfilled_through', [bindingId, 'unrecorded'])).rejects.toMatchObject({ code: '23514', constraint: 'usage_events_fulfilment_matches_binding' });
    // A resource with no binding to say whose it is.
    await expect(insert('provider_resource_id', [resourceId])).rejects.toMatchObject({ code: '23514', constraint: 'usage_events_resource_needs_binding' });
    // A binding at Twilio recorded as usage at another provider.
    await expect(
      pg.query(
        `insert into public.usage_events (organization_id, meter_id, quantity, provider_key, customer_currency, provider_binding_id, fulfilled_through)
         values ($1, 'email_send', 1, 'resend', $2, $3, 'organization_binding')`, [tenant.organizationId, CURRENCY, bindingId]),
    ).rejects.toMatchObject({ code: '23503', constraint: 'usage_events_binding_same_org_and_provider' });
    // A retail rate for a different meter.
    const { rows: voiceRate } = await pg.query(`select id from public.platform_retail_rates where meter_id = 'voice_minutes' and currency = $1 limit 1`, [CURRENCY]);
    await expect(insert('retail_rate_id, customer_charge_micros', [voiceRate[0].id, 0])).rejects.toMatchObject({ code: '23503', constraint: 'usage_events_retail_rate_matches' });
    // An account of a different provider.
    const { rows: account } = await pg.query(`insert into public.platform_provider_accounts (provider_key, label, credential_kind) values ('resend', 'fixture', 'api_key') returning id`);
    await expect(insert('provider_account_id', [account[0].id])).rejects.toMatchObject({ code: '23503', constraint: 'usage_events_account_same_provider' });
    await pg.query('delete from public.platform_provider_accounts where id = $1', [account[0].id]);
  });
});

describe('a real call can be traced end to end', () => {
  it('runs from the business through the capability and fulfilment to the cost and the retail rate', async () => {
    const callId = await recordCall(tenant.db, {
      organizationId: tenant.organizationId, customerId: tenant.customerId,
      direction: 'outbound', fromNumber: NUMBER, toNumber: '+14165550142',
    });
    await pg.query('select app.charge_for_call($1, $2)', [callId, 90]);

    const { rows } = await pg.query(
      `select u.quantity, u.customer_charge_micros, u.provider_cost_micros, u.provider_currency,
              o.id as organization_id, m.id as meter, f.key as feature, b.id as binding, r.id as resource,
              a.id as account, pr.unit_amount_micros as provider_rate, rr.unit_amount_micros as retail_rate,
              u.provider_binding_id, u.provider_resource_id, u.provider_account_id
         from public.usage_events u
         join public.organizations o on o.id = u.organization_id
         join public.platform_meters m on m.id = u.meter_id
         left join public.platform_catalog_features f on f.id = u.feature_id
         left join public.organization_provider_bindings b on b.id = u.provider_binding_id
         left join public.organization_provider_resources r on r.id = u.provider_resource_id
         left join public.platform_provider_accounts a on a.id = u.provider_account_id
         left join public.platform_provider_rates pr on pr.id = u.provider_rate_id
         left join public.platform_retail_rates rr on rr.id = u.retail_rate_id
        where u.organization_id = $1 and u.reference = $2`,
      [tenant.organizationId, callId],
    );
    expect(rows).toHaveLength(1);
    const event = rows[0];
    expect(event.meter).toBe('voice_minutes');
    expect(event.feature).toBe('outbound_calling');
    expect(event.binding).toBe(bindingId);
    expect(event.resource).toBe(resourceId);
    expect(event.account).toBe(accountId);
    expect(Number(event.quantity)).toBe(2);
    // The charge is the retail rate in force when the call ended, times the minutes.
    expect(Number(event.retail_rate)).toBe(7_000_000);
    expect(Number(event.customer_charge_micros)).toBe(14_000_000);
    // The cost is whatever provider rate stood, times the minutes, and nothing where none did.
    expect(Number(event.provider_cost_micros)).toBe(event.provider_rate ? Number(event.provider_rate) * 2 : 0);
  });

  it('records an inbound call against the inbound capability and the number that was dialled', async () => {
    const callId = await recordCall(tenant.db, {
      organizationId: tenant.organizationId, customerId: tenant.customerId,
      direction: 'inbound', fromNumber: '+14165550142', toNumber: NUMBER,
    });
    await pg.query('select app.charge_for_call($1, $2)', [callId, 30]);
    const { rows } = await pg.query(
      `select f.key as feature, u.provider_resource_id from public.usage_events u
         left join public.platform_catalog_features f on f.id = u.feature_id
        where u.organization_id = $1 and u.reference = $2`, [tenant.organizationId, callId]);
    expect(rows[0]).toEqual({ feature: 'inbound_calling', provider_resource_id: resourceId });
  });

  it('records a call on a number the business has not recorded as unrecorded, not as somebody else’s', async () => {
    const callId = await recordCall(other.db, {
      organizationId: other.organizationId, customerId: other.customerId,
      direction: 'outbound', fromNumber: '+14165550199', toNumber: '+14165550142',
    });
    await pg.query('select app.charge_for_call($1, $2)', [callId, 30]);
    const { rows } = await pg.query(
      `select provider_resource_id, provider_binding_id from public.usage_events where organization_id = $1 and reference = $2`,
      [other.organizationId, callId]);
    // No recorded number, so no resource; the business's one binding at the carrier still is what
    // carried it.
    expect(rows[0].provider_resource_id).toBeNull();
    expect(rows[0].provider_binding_id).toBe(otherBindingId);
  });
});

describe('what a usage event cost and charged is written once', () => {
  it('keeps an event’s cost, charge and rate rows when rates change afterwards', async () => {
    const meter = 'sms_segment';
    const first = (await pg.query(`select app.record_usage($1, $2, 3, 'twilio', now(), null, null, null, $3, '') as id`, [tenant.organizationId, meter, `hist-${randomUUID()}`])).rows[0].id;
    const snapshot = async () =>
      (await pg.query(
        `select provider_cost_micros, provider_currency, provider_rate_id, customer_charge_micros, retail_rate_id from public.usage_events where id = $1`, [first])).rows[0];
    const before = await snapshot();

    // The provider raises its price and GOLD reprices, both from now on.
    await new Promise((resolve) => setTimeout(resolve, 20));
    await recordProviderRate(staff, {
      providerKey: 'twilio', meterId: meter, currency: 'USD', unitAmountMicros: 999_999, source: 'usage-economics.test.ts',
    });
    await pg.query(
      `insert into public.platform_retail_rates (meter_id, currency, unit_amount_micros, effective_from, source)
       values ($1, $2, 50000000, now(), 'usage-economics.test.ts')`, [meter, CURRENCY]);

    expect(await snapshot()).toEqual(before);

    // New usage takes the new rates, and names different rate rows.
    const later = (await pg.query(`select app.record_usage($1, $2, 3, 'twilio', now(), null, null, null, $3, '') as id`, [tenant.organizationId, meter, `hist-${randomUUID()}`])).rows[0].id;
    const { rows } = await pg.query('select provider_cost_micros, provider_rate_id, customer_charge_micros, retail_rate_id from public.usage_events where id = $1', [later]);
    expect(Number(rows[0].provider_cost_micros)).toBe(3 * 999_999);
    expect(Number(rows[0].customer_charge_micros)).toBe(3 * 50_000_000);
    expect(rows[0].provider_rate_id).not.toBe(before.provider_rate_id);
    expect(rows[0].retail_rate_id).not.toBe(before.retail_rate_id);
  });

  it('prices usage that occurred before a rate change at the rate then in force', async () => {
    const provider = await pg.query(`select effective_from from public.platform_provider_rates where provider_key = 'twilio' and meter_id = 'sms_segment' and source = 'usage-economics.test.ts' order by effective_from desc limit 1`);
    const justBefore = new Date(new Date(provider.rows[0].effective_from).getTime() - 1000).toISOString();
    const id = (await pg.query(`select app.record_usage($1, 'sms_segment', 1, 'twilio', $2::timestamptz, null, null, null, $3, '') as id`, [tenant.organizationId, justBefore, `retro-${randomUUID()}`])).rows[0].id;
    const { rows } = await pg.query('select provider_cost_micros from public.usage_events where id = $1', [id]);
    expect(Number(rows[0].provider_cost_micros)).not.toBe(999_999);
  });

  it('adds a reconciliation beside an event and leaves the event’s own cost alone', async () => {
    const id = (await pg.query(`select app.record_usage($1, 'sms_segment', 2, 'twilio', now(), null, null, null, $2, '') as id`, [tenant.organizationId, `rec-${randomUUID()}`])).rows[0].id;
    const before = (await pg.query('select provider_cost_micros, provider_rate_id from public.usage_events where id = $1', [id])).rows[0];
    await recordUsageReconciliation(staff, {
      usageEventId: id, reconciledProviderCostMicros: 123_456, providerCurrency: 'USD', source: 'usage-economics.test.ts',
    });
    const after = (await pg.query('select provider_cost_micros, provider_rate_id from public.usage_events where id = $1', [id])).rows[0];
    expect(after).toEqual(before);
    const { rows } = await pg.query('select count(*)::int as n from public.usage_cost_reconciliations where usage_event_id = $1', [id]);
    expect(rows[0].n).toBe(1);
  });

  it('holds the rate rows an event used in place: they cannot be deleted from under it', async () => {
    const { rows } = await pg.query(
      `select retail_rate_id from public.usage_events where organization_id = $1 and retail_rate_id is not null limit 1`, [tenant.organizationId]);
    await expect(pg.query('delete from public.platform_retail_rates where id = $1', [rows[0].retail_rate_id])).rejects.toMatchObject({ code: '23503' });
  });
});


describe('usage exists whatever its pricing state', () => {
  const detailFor = async (organizationId: string, id: string) => {
    const detail = await organizationUsageDetail(staff, { organizationId });
    const row = detail.find((entry) => entry.usageEventId === id);
    expect(row).toBeTruthy();
    return row!;
  };
  const record = async (organizationId: string, meter: string, provider: string, extra = '') =>
    (await pg.query(`select app.record_usage($1, $2, 2, $3, now(), null, null, null, $4${extra}) as id`, [organizationId, meter, provider, `state-${randomUUID()}`])).rows[0].id as string;

  it('keeps a real provider-backed call when the business has no currency, and says why it is not priced', async () => {
    const stateless = await newTenant('econ-nocurrency');
    const numberForStateless = '+14165550166';
    const { bindingId: statelessBinding, resourceId: statelessResource } = await fulfilment(stateless.organizationId, numberForStateless, accountId);
    // A business that has not said what it trades in.
    await pg.query('update public.organizations set currency = null where id = $1', [stateless.organizationId]);

    const callId = await recordCall(stateless.db, {
      organizationId: stateless.organizationId, customerId: stateless.customerId,
      direction: 'outbound', fromNumber: numberForStateless, toNumber: '+14165550142',
    });
    await pg.query('select app.charge_for_call($1, $2)', [callId, 90]);

    const { rows } = await pg.query(
      `select id, quantity, provider_binding_id, provider_resource_id, provider_account_id, fulfilled_through,
              customer_currency, customer_charge_micros, retail_rate_id
         from public.usage_events where organization_id = $1 and reference = $2`,
      [stateless.organizationId, callId],
    );
    // The call is usage: it exists, with its provider provenance, and nothing was invented for
    // the retail side.
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(2);
    expect(rows[0].provider_binding_id).toBe(statelessBinding);
    expect(rows[0].provider_resource_id).toBe(statelessResource);
    expect(rows[0].provider_account_id).toBe(accountId);
    expect(rows[0].fulfilled_through).toBe('organization_binding');
    expect(rows[0].customer_currency).toBeNull();
    expect(rows[0].customer_charge_micros).toBeNull();
    expect(rows[0].retail_rate_id).toBeNull();

    // Staff can find it, and it says why it is not priced: not free.
    const detail = await detailFor(stateless.organizationId, rows[0].id);
    expect(detail.retailState).toBe('no_currency');
    expect(detail.customerChargeMinor).toBeNull();
    expect(detail.awaitingReconciliation).toBe(true);

    // Its cost can still be reconciled, and the retail side stays empty until the business is configured.
    await recordUsageReconciliation(staff, {
      usageEventId: rows[0].id, reconciledProviderCostMicros: 250_000, providerCurrency: 'USD', source: 'usage-economics.test.ts',
    });
    const reconciled = await detailFor(stateless.organizationId, rows[0].id);
    expect(reconciled.reconciledCostMicros).toBe(250_000);
    expect(reconciled.providerState).toBe('costed');
    expect(reconciled.awaitingReconciliation).toBe(false);
    expect(reconciled.retailState).toBe('no_currency');

    // A business that cannot be priced is not stopped from working, and the summary counts what is unpriced.
    expect(await pg.query('select app.may_spend_on($1, $2, 1) as ok', [stateless.organizationId, 'voice_minutes']).then((r) => r.rows[0].ok)).toBe(true);
    const summary = await organizationCommercialSummary(staff, { organizationId: stateless.organizationId });
    const voice = summary.find((row) => row.meterId === 'voice_minutes');
    expect(voice?.quantity).toBe(2);
    expect(voice?.unpricedQuantity).toBe(2);
    expect(voice?.marginMinor).toBeNull();
  });

  it('tells no retail price from a retail price of zero', async () => {
    // call_recording_minutes has a rate of nothing in this currency; transcription_seconds has none.
    const zero = await record(tenant.organizationId, 'call_recording_minutes', 'twilio');
    const none = await record(tenant.organizationId, 'transcription_seconds', 'deepgram');

    const rows = (await pg.query('select id, customer_charge_micros, retail_rate_id from public.usage_events where id = any($1)', [[zero, none]])).rows;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    expect(byId[zero].customer_charge_micros).not.toBeNull();
    expect(Number(byId[zero].customer_charge_micros)).toBe(0);
    expect(byId[zero].retail_rate_id).not.toBeNull();
    expect(byId[none].customer_charge_micros).toBeNull();
    expect(byId[none].retail_rate_id).toBeNull();

    expect((await detailFor(tenant.organizationId, zero)).retailState).toBe('priced');
    expect((await detailFor(tenant.organizationId, none)).retailState).toBe('no_rate');
    expect((await detailFor(tenant.organizationId, zero)).customerChargeMinor).toBe(0);
    expect((await detailFor(tenant.organizationId, none)).customerChargeMinor).toBeNull();
  });

  it('distinguishes all five cases, and none of them loses the usage', async () => {
    // 1. provider usage, provider cost, retail charge: a text on a priced meter with a provider rate.
    const priced = await record(tenant.organizationId, 'sms_segment', 'twilio');
    // 2. provider usage, provider cost, no retail price: email has a provider rate and no retail rate yet.
    const costedNoPrice = await record(tenant.organizationId, 'email_send', 'resend');
    // 3. provider cost not applicable: usage that carries none.
    const noCost = (await pg.query(`select app.record_usage($1, 'sms_segment', 2, 'twilio', now(), null, null, null, $2, '', null, false) as id`, [tenant.organizationId, `state-${randomUUID()}`])).rows[0].id as string;
    // 4. zero-priced retail: recording minutes are priced at nothing.
    const zero = await record(tenant.organizationId, 'call_recording_minutes', 'twilio');
    // 5. awaiting provider reconciliation: any costed usage no provider statement has confirmed.
    const awaiting = priced;

    const d1 = await detailFor(tenant.organizationId, priced);
    expect([d1.retailState, d1.providerState]).toEqual(['priced', 'costed']);
    expect(d1.customerChargeMinor).toBeGreaterThan(0);
    expect(d1.estimatedCostMicros).not.toBeNull();

    const d2 = await detailFor(tenant.organizationId, costedNoPrice);
    expect([d2.retailState, d2.providerState]).toEqual(['no_rate', 'costed']);
    expect(d2.customerChargeMinor).toBeNull();
    expect(d2.estimatedCostMicros).not.toBeNull();

    const d3 = await detailFor(tenant.organizationId, noCost);
    expect(d3.providerState).toBe('not_applicable');
    expect(d3.estimatedCostMicros).toBeNull();
    expect(d3.awaitingReconciliation).toBe(false);
    const rate3 = (await pg.query('select provider_rate_id, provider_cost_micros from public.usage_events where id = $1', [noCost])).rows[0];
    expect(rate3).toEqual({ provider_rate_id: null, provider_cost_micros: null });

    const d4 = await detailFor(tenant.organizationId, zero);
    expect([d4.retailState, d4.customerChargeMinor]).toEqual(['priced', 0]);

    const d5 = await detailFor(tenant.organizationId, awaiting);
    expect(d5.awaitingReconciliation).toBe(true);
    await recordUsageReconciliation(staff, { usageEventId: awaiting, reconciledProviderCostMicros: 1, providerCurrency: 'USD', source: 'usage-economics.test.ts' });
    expect((await detailFor(tenant.organizationId, awaiting)).awaitingReconciliation).toBe(false);
  });

  it('leaves a not-yet-costed event uncosted rather than free, and withholds the margin until it is known', async () => {
    // No provider has a rate for this meter, so GOLD's cost is not known and is not zero.
    const uncosted = await record(tenant.organizationId, 'tts_characters', 'elevenlabs');
    const { rows } = await pg.query('select provider_cost_micros, provider_rate_id from public.usage_events where id = $1', [uncosted]);
    // tts_characters is a draft-only provider rate in the seed, so no approved rate applies.
    expect(rows[0]).toEqual({ provider_cost_micros: null, provider_rate_id: null });
    expect((await detailFor(tenant.organizationId, uncosted)).providerState).toBe('uncosted');

    const summary = await organizationCommercialSummary(staff, { organizationId: tenant.organizationId });
    const tts = summary.find((row) => row.meterId === 'tts_characters');
    expect(tts?.uncostedQuantity).toBe(2);
    expect(tts?.marginMinor).toBeNull();
  });
});
