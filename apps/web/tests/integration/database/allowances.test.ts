import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlan, setPlanQuota } from '@/lib/domain/catalogue/plans';
import { recordPlanAssignment, recordPlanQuotaOverride } from '@/lib/domain/catalogue/organization-plans';
import { allowanceDecision, organizationAllowanceStates } from '@/lib/domain/commercial/allowances';
import { listUsageEvents, organizationUsageDetail } from '@/lib/domain/commercial/usage';
import { createCustomer } from '@/lib/domain/customers/customers';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * One runtime answer to "what is this business allowed to consume right now", and one to "how much
 * of what it just used had it already paid for".
 *
 * What is proved here: allowances compose across a base Plan and its Add-ons and refuse to compose
 * across contradictory definitions; `reset_semantics` resolves into real boundaries from the
 * processor's own period, the Plan assignment's anchor or the calendar, and never from a
 * substituted calendar month pretending to be a billing period; consumption comes from the one
 * usage ledger and from real resource models, and says so when nothing counts it; a usage event
 * records what was included and what was billable and is rated on the billable part alone; that
 * record survives a later Plan, allowance and rate change unchanged; two concurrent operations
 * cannot both spend the last included unit; an allowance and the prepaid purse are two separate
 * gates; and none of it lets one business read another's, or any business read what GildOps paid.
 *
 * Every price here is in a currency invented for this run, because a retail rate has no tenant to
 * scope it by and this suite shares a database with others. Plans are invented per run for the
 * same reason.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function currencyCode(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = () => letters[Math.floor(Math.random() * 26)];
  return `X${pick()}${pick()}`;
}

const CURRENCY = currencyCode();
const RUN = randomUUID().slice(0, 8).replace(/[^a-z0-9]/g, 'a');
const DAY = 86_400_000;
/** 0.10 of a minor unit per minute, in micro-minor-units. */
const VOICE_MICROS = 100_000;

type Tenant = { db: SupabaseClient; organizationId: string; userId: string; email: string };

let pg: Client;
let staff: SupabaseClient;
let tenant: Tenant;
let other: Tenant;
let basePlanId: string;
let addonPlanId: string;

const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

async function signedIn(label: string): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

async function newTenant(label: string, timezone = 'UTC'): Promise<Tenant> {
  const { db, userId, email } = await signedIn(label);
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 6)}`,
    currency: CURRENCY,
    timezone,
  });
  return { db, organizationId, userId, email };
}

/** Records usage through the one door that writes the ledger, as a provider callback does. */
async function record(
  organizationId: string,
  meter: string,
  quantity: number,
  occurredAt?: string,
): Promise<string> {
  const { rows } = await pg.query(
    `select app.record_usage($1, $2, $3, 'twilio', coalesce($4::timestamptz, now()), null, null, null, $5, 'allowances.test.ts') as id`,
    [organizationId, meter, quantity, occurredAt ?? null, `alw-${randomUUID()}`],
  );
  return rows[0].id as string;
}

async function state(organizationId: string, allowanceKey: string) {
  const states = await organizationAllowanceStates(staff, { organizationId, allowanceKey });
  return states[0];
}

async function assign(organizationId: string, planId: string, periodStart?: string) {
  return recordPlanAssignment(staff, {
    organizationId,
    planId,
    periodStart: periodStart ?? new Date().toISOString().slice(0, 10),
    periodEnd: '9999-12-31',
    note: 'allowances.test.ts',
  });
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();

  tenant = await newTenant('alw-tenant', 'America/Toronto');
  other = await newTenant('alw-other');

  basePlanId = await createPlan(staff, {
    key: `alw_base_${RUN}`,
    kind: 'plan',
    label: 'Allowance Base',
    description: 'Invented for allowances.test.ts.',
    billable: true,
    saleStatus: 'unlisted',
  });
  addonPlanId = await createPlan(staff, {
    key: `alw_addon_${RUN}`,
    kind: 'addon',
    label: 'Allowance Add-on',
    description: 'Invented for allowances.test.ts.',
    billable: true,
    saleStatus: 'unlisted',
  });

  // A metered allowance over the one meter with a real writer, and a seat count with a real
  // counter behind it.
  await setPlanQuota(staff, {
    planId: basePlanId, allowanceKey: `alw_voice_${RUN}`, label: 'Voice minutes', unit: 'minute',
    includedQuantity: 10, period: 'month', allowanceType: 'usage', resetSemantics: 'billing_period',
    overageBehavior: 'metered', meterId: 'voice_minutes',
  });
  await setPlanQuota(staff, {
    planId: basePlanId, allowanceKey: 'users', label: 'Users', unit: 'user',
    includedQuantity: 3, period: 'none', allowanceType: 'capacity', resetSemantics: 'none',
    overageBehavior: 'not_applicable',
  });
  await setPlanQuota(staff, {
    planId: addonPlanId, allowanceKey: `alw_voice_${RUN}`, label: 'Extra voice minutes', unit: 'minute',
    includedQuantity: 5, period: 'month', allowanceType: 'usage', resetSemantics: 'billing_period',
    overageBehavior: 'metered', meterId: 'voice_minutes',
  });

  await retailRate('voice_minutes', VOICE_MICROS, -30 * DAY);
});

afterAll(async () => {
  try {
    // A shared database: everything this run invented goes back out again.
    await pg.query("delete from public.usage_events where note in ('allowances.test.ts', 'race')");
    await pg.query("delete from public.platform_retail_rates where source = 'allowances.test.ts'");
    await pg.query('delete from public.organization_plan_quota_overrides where note = $1', ['allowances.test.ts']);
    await pg.query('delete from public.organization_plan_assignments where note = $1', ['allowances.test.ts']);
    await pg.query('delete from public.platform_plans where key like $1', [`alw_%_${RUN}`]);
  } finally {
    await pg?.end();
  }
});

/**
 * Appended over a direct connection on purpose: `record_retail_rate` refuses an effective date in
 * the past, which is the operator door's rule about rewriting a price backwards. This suite needs
 * rate *history* to prove an old reading keeps its own rate, so it writes the history the
 * migrations' own seeds do.
 */
async function retailRate(meter: string, micros: number, offsetMs: number) {
  await pg.query(
    `insert into public.platform_retail_rates
       (meter_id, currency, unit_amount_micros, approval_state, effective_from, source)
     values ($1, $2, $3, 'approved', $4::timestamptz, 'allowances.test.ts')`,
    [meter, CURRENCY, micros, at(offsetMs)],
  );
}

// ---------------------------------------------------------------------------

describe('a commercial mutation needs the commercial permission', () => {
  let inspector: { db: SupabaseClient; userId: string; email: string };

  beforeAll(async () => {
    inspector = await signedIn('alw-inspector');
    // Staff who may look at an organization and nothing more. Written over a direct connection,
    // as every staff row is (D28).
    await pg.query(
      `insert into public.platform_staff (user_id, name, capabilities)
       values ($1, 'Inspector', array['platform.organizations'])`,
      [inspector.userId],
    );
  });

  it('lets platform.organizations inspect a tenant', async () => {
    const { data, error } = await inspector.db.from('organizations').select('id').eq('id', tenant.organizationId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    // And read the resolved allowances, which is a read and not a mutation.
    expect(await organizationAllowanceStates(inspector.db, { organizationId: tenant.organizationId })).toBeDefined();
  });

  it('refuses every commercial mutation to platform.organizations alone', async () => {
    const refusals = await Promise.all([
      inspector.db.rpc('record_plan_assignment', {
        p_organization_id: tenant.organizationId, p_plan_id: basePlanId,
        p_period_start: '2026-01-01', p_period_end: '2026-02-01', p_note: '',
      }),
      inspector.db.rpc('record_organization_plan_agreement', {
        p_organization_id: tenant.organizationId, p_plan_id: basePlanId, p_currency: CURRENCY,
        p_amount_minor: 1, p_effective_from: new Date().toISOString(), p_effective_to: null, p_note: '',
      }),
      inspector.db.rpc('record_plan_quota_override', {
        p_organization_id: tenant.organizationId, p_plan_id: basePlanId,
        p_allowance_key: `alw_voice_${RUN}`, p_included_quantity: 9999,
        p_hard_limit: undefined, p_effective_from: new Date().toISOString(), p_note: '',
      }),
      inspector.db.rpc('record_commercial_term', {
        p_organization_id: tenant.organizationId, p_product_key: 'module:billing',
        p_period_start: '2026-01-01', p_period_end: '9999-12-31', p_price_minor: 0,
        p_currency: null, p_quantity: 1, p_note: '',
      }),
      inspector.db.rpc('record_plan_agreement', {
        p_organization_id: tenant.organizationId, p_plan_id: basePlanId, p_currency: CURRENCY,
        p_amount_minor: 1, p_effective_from: new Date().toISOString(), p_note: '',
      }),
    ]);

    for (const refusal of refusals) {
      expect(refusal.error?.code).toBe('42501');
      expect(refusal.error?.message ?? '').toMatch(/platform\.commercial/);
    }
  });

  it('nothing the refused calls would have written exists', async () => {
    const { rows } = await pg.query(
      `select
         (select count(*) from public.organization_plan_assignments
           where organization_id = $1 and plan_id = $2 and period_start = '2026-01-01')::int as assignments,
         (select count(*) from public.organization_plan_agreements
           where organization_id = $1 and amount_minor = 1)::int as agreements,
         (select count(*) from public.organization_plan_quota_overrides
           where organization_id = $1 and included_quantity = 9999)::int as overrides`,
      [tenant.organizationId, basePlanId],
    );
    expect(rows[0]).toEqual({ assignments: 0, agreements: 0, overrides: 0 });
  });

  it('lets platform.commercial perform the same mutations', async () => {
    const assignmentId = await assign(tenant.organizationId, basePlanId);
    expect(assignmentId).toBeTruthy();
    await assign(tenant.organizationId, addonPlanId);
  });

  it('refuses a non-staff caller too, by the same door', async () => {
    const { error } = await tenant.db.rpc('record_plan_assignment', {
      p_organization_id: tenant.organizationId, p_plan_id: basePlanId,
      p_period_start: '2026-01-01', p_period_end: '2026-02-01', p_note: '',
    });
    expect(error?.code).toBe('42501');
    expect(error?.message ?? '').toMatch(/only platform staff/);
  });
});

describe('composition', () => {
  it('sums compatible contributions and keeps every one as provenance', async () => {
    const voice = await state(tenant.organizationId, `alw_voice_${RUN}`);
    expect(voice.included).toBe(15); // 10 from the Plan + 5 from the Add-on
    expect(voice.sourceContributions.map((c) => [c.planKind, c.effective])).toEqual([
      ['plan', 10],
      ['addon', 5],
    ]);
    // The base Plan's own label wins, rather than whichever row sorted last.
    expect(voice.label).toBe('Voice minutes');
    expect(voice.state).toBe('available');
    expect(voice.configurationError).toBeNull();
  });

  it('applies an organization override and keeps the Plan default beside it', async () => {
    await recordPlanQuotaOverride(staff, {
      organizationId: tenant.organizationId, planId: basePlanId,
      allowanceKey: `alw_voice_${RUN}`, includedQuantity: 6, hardLimit: 20,
      effectiveFrom: at(-60_000), note: 'allowances.test.ts',
    });
    const voice = await state(tenant.organizationId, `alw_voice_${RUN}`);
    expect(voice.included).toBe(11); // 6 overridden + 5 from the Add-on, which has no override
    expect(voice.hardLimit).toBeNull(); // the Add-on states none, so the whole allowance is unlimited
    const base = voice.sourceContributions.find((c) => c.planKind === 'plan');
    expect([base?.planDefault, base?.override, base?.overridden]).toEqual([10, 6, true]);
  });

  it('sums hard limits only when every contribution states one', async () => {
    await recordPlanQuotaOverride(staff, {
      organizationId: tenant.organizationId, planId: addonPlanId,
      allowanceKey: `alw_voice_${RUN}`, includedQuantity: 5, hardLimit: 8,
      effectiveFrom: at(-60_000), note: 'allowances.test.ts',
    });
    const voice = await state(tenant.organizationId, `alw_voice_${RUN}`);
    expect(voice.included).toBe(11);
    expect(voice.hardLimit).toBe(28); // 20 + 8
  });

  it('refuses to compose contradictory definitions and names the axis', async () => {
    // The Add-on now calls the same allowance a weekly calendar one; nothing may silently pick.
    await setPlanQuota(staff, {
      planId: addonPlanId, allowanceKey: `alw_voice_${RUN}`, label: 'Extra voice minutes', unit: 'minute',
      includedQuantity: 5, period: 'week', allowanceType: 'usage', resetSemantics: 'calendar_period',
      overageBehavior: 'metered', meterId: 'voice_minutes',
    });
    const voice = await state(tenant.organizationId, `alw_voice_${RUN}`);
    expect(voice.state).toBe('configuration_error');
    expect(voice.included).toBeNull();
    expect(voice.configurationError).toMatch(/period/);
    expect(voice.configurationError).toMatch(/reset semantics/);
    expect(voice.sourceContributions).toHaveLength(2);

    // A configuration error permits rather than stopping a business working.
    const decision = await allowanceDecision(staff, {
      organizationId: tenant.organizationId, allowanceKey: `alw_voice_${RUN}`, quantity: 1,
    });
    expect([decision.result, decision.permitted]).toEqual(['configuration_error', true]);

    // Restored, so the rest of the suite reads a coherent allowance again.
    await setPlanQuota(staff, {
      planId: addonPlanId, allowanceKey: `alw_voice_${RUN}`, label: 'Extra voice minutes', unit: 'minute',
      includedQuantity: 5, period: 'month', allowanceType: 'usage', resetSemantics: 'billing_period',
      overageBehavior: 'metered', meterId: 'voice_minutes',
    });
    expect((await state(tenant.organizationId, `alw_voice_${RUN}`)).state).toBe('available');
  });

  it('says nothing at all for an organization with no Plan', async () => {
    const bare = await newTenant('alw-bare');
    expect(await organizationAllowanceStates(staff, { organizationId: bare.organizationId })).toEqual([]);
    // Which is not a refusal: no allowance governs it, so the operation is allowed and ungoverned.
    const decision = await allowanceDecision(staff, {
      organizationId: bare.organizationId, allowanceKey: `alw_voice_${RUN}`, quantity: 100,
    });
    expect([decision.result, decision.permitted, decision.governed]).toEqual(['allowed', true, false]);
  });
});

describe('a period means something', () => {
  const window = async (reset: string, period: string, organizationId: string, atMoment?: string) => {
    const { rows } = await pg.query(
      `select * from app.allowance_window($1, $2, $3, coalesce($4::timestamptz, now()))`,
      [organizationId, reset, period, atMoment ?? null],
    );
    return rows[0] as { starts_at: string | null; ends_at: string | null; basis: string };
  };

  it('resolves a calendar month and week in the organization timezone', async () => {
    const month = await window('calendar_period', 'month', tenant.organizationId);
    expect(month.basis).toBe('calendar');
    // Toronto, so the month begins at local midnight, not UTC midnight.
    expect(new Date(month.starts_at!).toISOString()).toMatch(/T0[45]:00:00/);
    const week = await window('calendar_period', 'week', tenant.organizationId);
    expect(new Date(week.ends_at!).getTime() - new Date(week.starts_at!).getTime()).toBe(7 * DAY);
  });

  it('has no window at all for reset semantics of none', async () => {
    const none = await window('none', 'month', tenant.organizationId);
    expect([none.starts_at, none.ends_at, none.basis]).toEqual([null, null, 'none']);
    const seats = await state(tenant.organizationId, 'users');
    expect([seats.window.startsAt, seats.window.basis]).toEqual([null, 'none']);
  });

  it('anchors a billing period on the Plan assignment when no subscription period exists', async () => {
    const anchored = await newTenant('alw-anchor');
    await assign(anchored.organizationId, basePlanId, '2026-03-15');
    const voice = await state(anchored.organizationId, `alw_voice_${RUN}`);
    expect(voice.window.basis).toBe('assignment');
    // The 15th of the month containing today, never the 1st — a calendar month substituted for a
    // billing period is exactly what this refuses to do.
    expect(new Date(voice.window.startsAt!).getUTCDate()).toBe(15);
    expect(new Date(voice.window.endsAt!).getUTCDate()).toBe(15);
  });

  it('prefers the processor own period once one covers the moment, and says which', async () => {
    const subscribed = await newTenant('alw-sub');
    await assign(subscribed.organizationId, basePlanId, '2026-03-15');
    const periodStart = at(-3 * DAY);
    const periodEnd = at(27 * DAY);
    await pg.query(
      `insert into public.organization_platform_subscriptions
         (organization_id, environment, provider, subscription_reference, price_reference, status,
          currency, current_period_start, current_period_end)
       values ($1, 'live', 'stripe', $2, $3, 'active', $4, $5, $6)`,
      [subscribed.organizationId, `sub_${randomUUID()}`, `price_${randomUUID()}`, CURRENCY, periodStart, periodEnd],
    );
    const voice = await state(subscribed.organizationId, `alw_voice_${RUN}`);
    expect(voice.window.basis).toBe('subscription');
    expect(new Date(voice.window.startsAt!).toISOString()).toBe(new Date(periodStart).toISOString());
    expect(new Date(voice.window.endsAt!).toISOString()).toBe(new Date(periodEnd).toISOString());
  });

  it('puts a moment exactly on a reset boundary in the period that starts there', async () => {
    const boundary = await newTenant('alw-boundary');
    await assign(boundary.organizationId, basePlanId, '2026-03-15');
    const first = await window('billing_period', 'month', boundary.organizationId, '2026-04-15T00:00:00Z');
    expect(new Date(first.starts_at!).toISOString()).toBe('2026-04-15T00:00:00.000Z');
    // And the instant before it belongs to the period that ends there.
    const before = await window('billing_period', 'month', boundary.organizationId, '2026-04-14T23:59:59.999Z');
    expect(new Date(before.ends_at!).toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  it('counts only usage inside the window', async () => {
    const windowed = await newTenant('alw-window');
    await assign(windowed.organizationId, basePlanId);
    const current = await state(windowed.organizationId, `alw_voice_${RUN}`);
    await record(windowed.organizationId, 'voice_minutes', 4, current.window.startsAt!);
    // Two months before the window opened: real usage, outside this period.
    await record(windowed.organizationId, 'voice_minutes', 7, at(-60 * DAY));
    expect((await state(windowed.organizationId, `alw_voice_${RUN}`)).consumed).toBe(4);
  });
});

describe('consumption', () => {
  it('counts a real resource model where one exists, and says so where none does', async () => {
    const seats = await state(tenant.organizationId, 'users');
    expect(seats.enforcement).toBe('counted');
    expect(seats.consumed).toBe(1); // the founding owner
    expect(seats.remaining).toBe(2);

    // `technicians` has no counter: it resolves its definition and declines to report consumption.
    const unenforced = await createPlan(staff, {
      key: `alw_unenf_${RUN}`, kind: 'plan', label: 'Unenforced', description: 'x',
      billable: false, saleStatus: 'unlisted',
    });
    await setPlanQuota(staff, {
      planId: unenforced, allowanceKey: 'technicians', label: 'Technicians', unit: 'user',
      includedQuantity: 4, period: 'none', allowanceType: 'capacity', resetSemantics: 'none',
      overageBehavior: 'not_applicable',
    });
    const bare = await newTenant('alw-unenf');
    await assign(bare.organizationId, unenforced);
    const technicians = await state(bare.organizationId, 'technicians');
    expect([technicians.enforcement, technicians.consumed, technicians.remaining]).toEqual([
      'unenforced', null, null,
    ]);
    // Nothing counts it, so nothing can be said to be used up.
    const decision = await allowanceDecision(staff, {
      organizationId: bare.organizationId, allowanceKey: 'technicians', quantity: 99,
    });
    expect([decision.result, decision.enforcement]).toEqual(['allowed', 'unenforced']);
  });

  it('reports zero, partial, exact, crossing and already-over consumption', async () => {
    const walk = await newTenant('alw-walk');
    await assign(walk.organizationId, basePlanId); // 10 included, metered overage, no hard limit
    const key = `alw_voice_${RUN}`;
    const decide = (n: number) => allowanceDecision(staff, { organizationId: walk.organizationId, allowanceKey: key, quantity: n });

    expect((await state(walk.organizationId, key)).consumed).toBe(0);
    expect((await decide(10)).result).toBe('allowed');

    await record(walk.organizationId, 'voice_minutes', 4);
    let now = await state(walk.organizationId, key);
    expect([now.consumed, now.remaining, now.overageQuantity]).toEqual([4, 6, 0]);

    // Exactly at the included quantity.
    await record(walk.organizationId, 'voice_minutes', 6);
    now = await state(walk.organizationId, key);
    expect([now.consumed, now.remaining, now.overageQuantity, now.state]).toEqual([10, 0, 0, 'available']);

    // The next unit is entirely overage.
    const next = await decide(1);
    expect([next.result, next.includedApplied, next.overageApplied]).toEqual(['allowed_with_overage', 0, 1]);

    // Crossing the included quantity inside one event is split, not refused and not rounded.
    const crossing = await newTenant('alw-cross');
    await assign(crossing.organizationId, basePlanId);
    await record(crossing.organizationId, 'voice_minutes', 7);
    const split = await decide(0);
    expect(split).toBeTruthy();
    const crossingDecision = await allowanceDecision(staff, {
      organizationId: crossing.organizationId, allowanceKey: key, quantity: 8,
    });
    expect([crossingDecision.includedApplied, crossingDecision.overageApplied]).toEqual([3, 5]);
  });
});

describe('enforcement', () => {
  it('returns each supported decision, and permits exactly three of them', async () => {
    const limits = await createPlan(staff, {
      key: `alw_limits_${RUN}`, kind: 'plan', label: 'Limits', description: 'x',
      billable: false, saleStatus: 'unlisted',
    });
    await setPlanQuota(staff, {
      planId: limits, allowanceKey: `alw_hard_${RUN}`, label: 'Hard minutes', unit: 'minute',
      includedQuantity: 5, period: 'none', allowanceType: 'usage', resetSemantics: 'none',
      overageBehavior: 'hard_limit', meterId: 'call_recording_minutes',
    });
    await setPlanQuota(staff, {
      planId: limits, allowanceKey: `alw_soft_${RUN}`, label: 'Soft minutes', unit: 'minute',
      includedQuantity: 5, period: 'none', allowanceType: 'usage', resetSemantics: 'none',
      overageBehavior: 'soft_limit', meterId: 'transcription_seconds',
    });
    await setPlanQuota(staff, {
      planId: limits, allowanceKey: `alw_flag_${RUN}`, label: 'A switch', unit: 'entitlement',
      includedQuantity: 0, period: 'none', allowanceType: 'boolean', resetSemantics: 'none',
      overageBehavior: 'not_applicable',
    });

    const org = await newTenant('alw-limits');
    await assign(org.organizationId, limits);
    const decide = (key: string, n: number) =>
      allowanceDecision(staff, { organizationId: org.organizationId, allowanceKey: key, quantity: n });

    expect((await decide(`alw_hard_${RUN}`, 5)).result).toBe('allowed');
    expect((await decide(`alw_hard_${RUN}`, 6)).result).toBe('hard_limit_reached');
    expect((await decide(`alw_hard_${RUN}`, 6)).permitted).toBe(false);
    expect((await decide(`alw_soft_${RUN}`, 6)).result).toBe('soft_limit_warning');
    expect((await decide(`alw_soft_${RUN}`, 6)).permitted).toBe(true);
    expect((await decide(`alw_flag_${RUN}`, 1)).result).toBe('not_entitled');
    expect((await decide(`alw_flag_${RUN}`, 1)).permitted).toBe(false);

    // Past the included quantity on a soft limit, the state says so without refusing.
    await record(org.organizationId, 'transcription_seconds', 5);
    expect((await state(org.organizationId, `alw_soft_${RUN}`)).state).toBe('soft_limit');
    await record(org.organizationId, 'call_recording_minutes', 5);
    expect((await state(org.organizationId, `alw_hard_${RUN}`)).state).toBe('hard_limit');
  });

  it('refuses a call at a hard limit through the mutation boundary, not a disabled button', async () => {
    const limited = await createPlan(staff, {
      key: `alw_voicecap_${RUN}`, kind: 'plan', label: 'Capped voice', description: 'x',
      billable: false, saleStatus: 'unlisted',
    });
    await setPlanQuota(staff, {
      planId: limited, allowanceKey: `alw_cap_${RUN}`, label: 'Capped minutes', unit: 'minute',
      includedQuantity: 2, period: 'none', allowanceType: 'usage', resetSemantics: 'none',
      overageBehavior: 'hard_limit', meterId: 'voice_minutes',
    });
    const capped = await newTenant('alw-capped');
    await assign(capped.organizationId, limited);

    // Credit enough to pay for anything, so what refuses can only be the allowance.
    await pg.query(
      `insert into public.organization_credits (organization_id, amount_minor, currency, reason)
       values ($1, 100000, $2, 'purchase')`,
      [capped.organizationId, CURRENCY],
    );

    const { rows: before } = await pg.query(`select * from app.spend_decision($1, 'voice_minutes', 1)`, [capped.organizationId]);
    expect(before[0].allowed).toBe(true);
    expect(before[0].reason).toBe('included');

    await record(capped.organizationId, 'voice_minutes', 2);

    const { rows: after } = await pg.query(`select * from app.spend_decision($1, 'voice_minutes', 1)`, [capped.organizationId]);
    expect([after[0].allowed, after[0].reason]).toEqual([false, 'allowance_hard_limit']);

    const customerId = await createCustomer(capped.db, { organizationId: capped.organizationId, name: 'A Caller' });
    const { error } = await capped.db.rpc('open_call', {
      p_organization_id: capped.organizationId,
      p_customer_id: customerId,
      p_conference_name: `conf-${randomUUID()}`,
      p_from_number: '+14165550101',
      p_to_number: '+14165550102',
    });
    expect(error?.message ?? '').toMatch(/all the calling its plan allows/);

    const { rows: calls } = await pg.query('select count(*)::int n from public.calls where organization_id = $1', [capped.organizationId]);
    expect(calls[0].n).toBe(0);
  });
});

describe('an allowance and the purse are two gates', () => {
  it('needs no prepaid credit for included usage, and credit only for the chargeable part', async () => {
    const gated = await newTenant('alw-gated');
    await assign(gated.organizationId, basePlanId); // 10 included voice minutes, metered overage

    // Nothing bought in advance at all.
    const { rows: included } = await pg.query(`select * from app.spend_decision($1, 'voice_minutes', 1)`, [gated.organizationId]);
    expect([included[0].allowed, included[0].reason]).toEqual([true, 'included']);

    // Past the included quantity, the purse decides — and it is empty.
    await record(gated.organizationId, 'voice_minutes', 10);
    const { rows: overage } = await pg.query(`select * from app.spend_decision($1, 'voice_minutes', 1)`, [gated.organizationId]);
    expect([overage[0].allowed, overage[0].reason]).toEqual([false, 'insufficient_credit']);

    // One minute's worth of credit, and only the chargeable minute is drawn against.
    await pg.query(
      `insert into public.organization_credits (organization_id, amount_minor, currency, reason)
       values ($1, 1, $2, 'purchase')`,
      [gated.organizationId, CURRENCY],
    );
    const { rows: paid } = await pg.query(`select * from app.spend_decision($1, 'voice_minutes', 1)`, [gated.organizationId]);
    expect([paid[0].allowed, paid[0].reason]).toEqual([true, 'credit']);
    const { rows: tooMuch } = await pg.query(`select * from app.spend_decision($1, 'voice_minutes', 20)`, [gated.organizationId]);
    expect(tooMuch[0].allowed).toBe(false);
  });

  it('leaves a business with no Plan exactly where it was', async () => {
    const legacy = await newTenant('alw-legacy');
    // No assignment at all: the purse is the only gate, as it was before allowances existed.
    const { rows } = await pg.query(`select app.may_spend_on($1, 'voice_minutes', 1) as ok`, [legacy.organizationId]);
    expect(rows[0].ok).toBe(false); // priced, nothing bought
  });
});

describe('rating', () => {
  it('rates the billable part alone, and records what it decided', async () => {
    const rated = await newTenant('alw-rated');
    await assign(rated.organizationId, basePlanId); // 10 included

    const fully = await record(rated.organizationId, 'voice_minutes', 4);
    const partly = await record(rated.organizationId, 'voice_minutes', 8); // 6 included, 2 over
    const wholly = await record(rated.organizationId, 'voice_minutes', 3); // 0 included, 3 over

    const { rows } = await pg.query(
      `select id, quantity, allowance_key, allowance_included_total, allowance_consumed_before,
              allowance_included_applied, allowance_overage_quantity, customer_charge_micros,
              allowance_window_basis
         from public.usage_events where id = any($1) order by created_at`,
      [[fully, partly, wholly]],
    );
    const [a, b, c] = rows;

    // Quantity is always the usage that happened, never only the chargeable part.
    expect([Number(a.quantity), Number(b.quantity), Number(c.quantity)]).toEqual([4, 8, 3]);
    expect([Number(a.allowance_included_applied), Number(a.allowance_overage_quantity)]).toEqual([4, 0]);
    expect([Number(b.allowance_included_applied), Number(b.allowance_overage_quantity)]).toEqual([6, 2]);
    expect([Number(c.allowance_included_applied), Number(c.allowance_overage_quantity)]).toEqual([0, 3]);

    expect(Number(a.customer_charge_micros)).toBe(0);
    expect(Number(b.customer_charge_micros)).toBe(2 * VOICE_MICROS);
    expect(Number(c.customer_charge_micros)).toBe(3 * VOICE_MICROS);

    // Enough provenance to reconstruct the split without today's Plan.
    expect([Number(b.allowance_included_total), Number(b.allowance_consumed_before)]).toEqual([10, 4]);
    expect(b.allowance_window_basis).toBe('assignment');
  });

  it('tells included, zero-priced and unpriced apart', async () => {
    const telling = await newTenant('alw-telling');
    await assign(telling.organizationId, basePlanId);

    const included = await record(telling.organizationId, 'voice_minutes', 2);
    await record(telling.organizationId, 'voice_minutes', 8); // uses the rest of the allowance
    // A rate of exactly nothing, on a different meter, so a zero charge really is a zero price.
    await retailRate('email_send', 0, -10 * DAY);
    const zeroPriced = await record(telling.organizationId, 'email_send', 3);
    const unpriced = await record(telling.organizationId, 'tts_characters', 5);

    const events = await listUsageEvents(telling.db, { organizationId: telling.organizationId });
    const byId = new Map(events.map((event) => [event.id, event]));

    expect([byId.get(included)!.retailState, byId.get(included)!.allowanceApplication, byId.get(included)!.customerChargeMinor])
      .toEqual(['priced', 'included', 0]);
    expect([byId.get(zeroPriced)!.retailState, byId.get(zeroPriced)!.allowanceApplication, byId.get(zeroPriced)!.customerChargeMinor])
      .toEqual(['priced', 'ungoverned', 0]);
    expect([byId.get(unpriced)!.retailState, byId.get(unpriced)!.customerChargeMinor])
      .toEqual(['no_rate', null]);

    // Included and zero-priced are both a charge of nothing and are not the same financial fact.
    expect(byId.get(included)!.allowanceApplication).not.toBe(byId.get(zeroPriced)!.allowanceApplication);
  });

  it('records usage for a business with no currency without pricing it', async () => {
    const { db, email } = await signedIn('alw-nocur');
    const organizationId = await foundBusiness({ ownerEmail: email, name: `alw-nocur ${RUN}`, currency: 'CAD' });
    await pg.query('update public.organizations set currency = null where id = $1', [organizationId]);
    await assign(organizationId, basePlanId);
    const id = await record(organizationId, 'voice_minutes', 12);
    const events = await listUsageEvents(db, { organizationId });
    const event = events.find((candidate) => candidate.id === id)!;
    expect(event.retailState).toBe('no_currency');
    expect(event.customerChargeMinor).toBeNull();
    // The allowance split still happened: usage is a fact whether or not it can be priced.
    expect([event.includedQuantity, event.overageQuantity]).toEqual([10, 2]);
  });

  it('rates by the rate in force when the usage occurred, across a rate change', async () => {
    const transition = await newTenant('alw-transition');
    await assign(transition.organizationId, basePlanId);
    // Use the whole allowance up first, so every reading below is entirely chargeable.
    await record(transition.organizationId, 'voice_minutes', 10, at(-20 * DAY));

    await retailRate('voice_minutes', VOICE_MICROS * 3, -5 * DAY);

    const earlier = await record(transition.organizationId, 'voice_minutes', 1, at(-10 * DAY));
    const later = await record(transition.organizationId, 'voice_minutes', 1, at(-1 * DAY));
    const { rows } = await pg.query(
      'select id, customer_charge_micros from public.usage_events where id = any($1)',
      [[earlier, later]],
    );
    const charges = Object.fromEntries(rows.map((row) => [row.id, Number(row.customer_charge_micros)]));
    expect(charges[earlier]).toBe(VOICE_MICROS);
    expect(charges[later]).toBe(VOICE_MICROS * 3);
  });
});

describe('a rated event is history', () => {
  it('is unchanged by a later Plan, allowance and rate change', async () => {
    const historical = await newTenant('alw-history');
    await assign(historical.organizationId, basePlanId);
    const id = await record(historical.organizationId, 'voice_minutes', 14); // 10 included, 4 over

    const columns =
      'quantity, allowance_key, allowance_included_total, allowance_consumed_before, ' +
      'allowance_included_applied, allowance_overage_quantity, customer_charge_micros, retail_rate_id';
    const read = async () =>
      (await pg.query(`select ${columns} from public.usage_events where id = $1`, [id])).rows[0];
    const before = await read();

    // The Plan's own allowance changes.
    await setPlanQuota(staff, {
      planId: basePlanId, allowanceKey: `alw_voice_${RUN}`, label: 'Voice minutes', unit: 'minute',
      includedQuantity: 1000, period: 'month', allowanceType: 'usage', resetSemantics: 'billing_period',
      overageBehavior: 'metered', meterId: 'voice_minutes',
    });
    // This organization's own allowance changes.
    await recordPlanQuotaOverride(staff, {
      organizationId: historical.organizationId, planId: basePlanId,
      allowanceKey: `alw_voice_${RUN}`, includedQuantity: 1,
      effectiveFrom: at(-60_000), note: 'allowances.test.ts',
    });
    // And the retail rate changes.
    await retailRate('voice_minutes', VOICE_MICROS * 9, 1000);

    expect(await read()).toEqual(before);

    // Restored for any later test in the file.
    await setPlanQuota(staff, {
      planId: basePlanId, allowanceKey: `alw_voice_${RUN}`, label: 'Voice minutes', unit: 'minute',
      includedQuantity: 10, period: 'month', allowanceType: 'usage', resetSemantics: 'billing_period',
      overageBehavior: 'metered', meterId: 'voice_minutes',
    });
  });
});

describe('concurrency', () => {
  it('does not let two simultaneous operations both consume the last included unit', async () => {
    const racing = await newTenant('alw-race');
    await assign(racing.organizationId, basePlanId); // 10 included
    await record(racing.organizationId, 'voice_minutes', 9); // one left

    // Two transactions that both read consumption and both write, started before either commits.
    const a = new Client({ connectionString: CONNECTION });
    const b = new Client({ connectionString: CONNECTION });
    await a.connect();
    await b.connect();
    try {
      await a.query('begin');
      await b.query('begin');
      const call = (client: Client) =>
        client.query(
          `select app.record_usage($1, 'voice_minutes', 1, 'twilio', now(), null, null, null, $2, 'race') as id`,
          [racing.organizationId, `race-${randomUUID()}`],
        );
      // `a` takes the lock; `b` blocks on it until `a` commits, so it cannot read stale
      // consumption.
      const first = await call(a);
      const pending = call(b);
      await a.query('commit');
      const second = await pending;
      await b.query('commit');

      const { rows } = await pg.query(
        `select allowance_included_applied inc, allowance_overage_quantity ovr
           from public.usage_events where id = any($1) order by created_at`,
        [[first.rows[0].id, second.rows[0].id]],
      );
      // One of them took the last included unit and the other did not. Exactly one, never both.
      expect(rows.map((row) => [Number(row.inc), Number(row.ovr)]).sort()).toEqual([[0, 1], [1, 0]]);
      expect((await state(racing.organizationId, `alw_voice_${RUN}`)).consumed).toBe(11);
    } finally {
      await a.end();
      await b.end();
    }
  });
});

describe('what a business may read of this', () => {
  it('refuses one business the allowance state of another', async () => {
    await assign(other.organizationId, basePlanId);
    const own = await organizationAllowanceStates(tenant.db, { organizationId: tenant.organizationId });
    expect(own.length).toBeGreaterThan(0);
    await expect(
      organizationAllowanceStates(tenant.db, { organizationId: other.organizationId }),
    ).rejects.toMatchObject({ code: 'allowances.forbidden' });
    await expect(
      allowanceDecision(tenant.db, { organizationId: other.organizationId, allowanceKey: 'users' }),
    ).rejects.toMatchObject({ code: 'allowances.forbidden' });
  });

  it('shows a business its own allowance split and never GildOps own cost', async () => {
    const events = await listUsageEvents(tenant.db, { organizationId: tenant.organizationId });
    for (const event of events) {
      expect(Object.keys(event)).not.toContain('providerKey');
      expect(Object.keys(event)).not.toContain('providerCostMicros');
    }
    // The withheld columns are refused by the grant, not merely left out of a select.
    for (const column of ['provider_key', 'provider_cost_micros', 'provider_currency']) {
      const { error } = await tenant.db.from('usage_events').select(column).eq('organization_id', tenant.organizationId);
      expect(error, `usage_events.${column} must stay withheld`).not.toBeNull();
    }
  });

  it('keeps the staff rating projection staff-only', async () => {
    await expect(
      organizationUsageDetail(tenant.db, { organizationId: tenant.organizationId }),
    ).rejects.toMatchObject({ code: 'commercial.forbidden' });

    await record(tenant.organizationId, 'voice_minutes', 3);
    const detail = await organizationUsageDetail(staff, { organizationId: tenant.organizationId });
    expect(detail.length).toBeGreaterThan(0);
    // Both accounts, on one row, never blended.
    expect(detail[0]).toHaveProperty('allowanceApplication');
    expect(detail[0]).toHaveProperty('estimatedCostMicros');
  });
});
