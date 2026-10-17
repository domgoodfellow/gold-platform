import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { createPlan } from '@/lib/domain/catalogue/plans';
import { bootstrapOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { FOUNDING_ROLE } from '@/lib/domain/tenancy/organizations';
import { operatingOrganizationId, setAsideOperatingOrganization } from '@/tests/support/operating-organization';

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

async function signedInUser(label: string, options: { staff?: boolean } = {}) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  // Written over a direct connection, before sign-in: nothing in the application may write a staff row.
  if (options.staff) {
    await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [created.data.user.id, 'Operator']);
  }
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id };
}

async function emptyOrganization(label: string): Promise<string> {
  const id = randomUUID();
  await pg.query(
    `insert into public.organizations (id, name, timezone, currency, created_by) values ($1, $2, 'UTC', 'USD', $3)`,
    [id, `${label} ${randomUUID().slice(0, 8)}`, staff.userId],
  );
  created.push(id);
  return id;
}

async function counts(organizationId: string) {
  const { rows } = await pg.query<{ memberships: string; roles: string; assignments: string }>(
    `select
       (select count(*) from public.memberships where organization_id = $1 and user_id = $2)::text as memberships,
       (select count(*) from public.roles where organization_id = $1)::text as roles,
       (select count(*) from public.organization_plan_assignments where organization_id = $1)::text as assignments`,
    [organizationId, staff.userId],
  );
  return rows[0];
}

async function currentPlanKey(organizationId: string): Promise<string | null> {
  const { rows } = await pg.query<{ key: string }>(
    `select pp.key from public.organization_plan_assignments opa
       join public.platform_plans pp on pp.id = opa.plan_id
      where opa.organization_id = $1 and opa.plan_kind = 'plan'
        and opa.period_start <= current_date and opa.period_end > current_date`,
    [organizationId],
  );
  return rows[0]?.key ?? null;
}

async function otherPlan(): Promise<string> {
  return createPlan(staff.db, {
    key: `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    kind: 'plan',
    label: 'Ordinary customer plan',
    description: '',
    billable: false,
  });
}

let pg: Client;
let staff: { db: SupabaseClient; userId: string };
let restore: () => Promise<void>;
const created: string[] = [];
let operating: string;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client(CONNECTION);
  await pg.connect();
  restore = await setAsideOperatingOrganization(pg);
  staff = await signedInUser('bootstrap-staff', { staff: true });
});

afterAll(async () => {
  try {
    await restore?.();
    if (created.length > 0) {
      await pg.query(
        `delete from public.organization_plan_assignments
          where organization_id = any($1::uuid[])
            and plan_id = (select id from public.platform_plans where key = 'gold_internal')`,
        [created],
      );
    }
  } finally {
    await pg.end();
  }
});

describe('bootstrap_gold_internal_workspace', () => {
  it('refuses to make a business already on another base Plan the operating organization', async () => {
    const customer = await emptyOrganization('Customer on a plan');
    await recordPlanAssignment(staff.db, { organizationId: customer, planId: await otherPlan(), periodStart: '2000-01-01', periodEnd: '9999-12-31' });

    await expect(bootstrapOperatingOrganization(staff.db, { organizationId: customer })).rejects.toMatchObject({
      code: 'operating_organization.bootstrap_plan_conflict',
    });
    expect(await operatingOrganizationId(pg)).toBeNull();
    expect(await counts(customer)).toMatchObject({ memberships: '0', roles: '0' });
  });

  it('designates an empty organization and gives the caller a real membership with canonical founding authority', async () => {
    operating = await emptyOrganization('GildOps bootstrap');
    const bystander = await emptyOrganization('Customer untouched');

    const membershipId = await bootstrapOperatingOrganization(staff.db, { organizationId: operating });

    expect(await operatingOrganizationId(pg)).toBe(operating);
    const { rows } = await pg.query<{ user_id: string; organization_id: string; role_name: string; capabilities: string[] }>(
      `select m.user_id::text, m.organization_id::text, r.name as role_name, r.capabilities
         from public.memberships m
         join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
        where m.id = $1`,
      [membershipId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: staff.userId, organization_id: operating, role_name: FOUNDING_ROLE });
    expect(new Set(rows[0].capabilities)).toEqual(new Set(ALL_CAPABILITIES));
    expect(await currentPlanKey(operating)).toBe('gold_internal');
    expect(await counts(bystander)).toMatchObject({ memberships: '0', roles: '0', assignments: '0' });

    // Platform authority is not something the bootstrap writes.
    const staffRows = await pg.query('select 1 from public.platform_staff where user_id = $1', [staff.userId]);
    expect(staffRows.rowCount).toBe(1);

    const event = await pg.query<{ payload: Record<string, unknown> }>(
      `select payload from public.events
        where organization_id = $1 and action = 'gold_internal.bootstrap' order by occurred_at desc limit 1`,
      [operating],
    );
    expect(event.rows[0].payload).toMatchObject({ membership_id: membershipId, operating_organization_designated: true });
  });

  it('repeated for the same organization, changes nothing it already established', async () => {
    const before = await counts(operating);
    const first = await pg.query<{ id: string }>(
      'select id from public.memberships where organization_id = $1 and user_id = $2',
      [operating, staff.userId],
    );

    const membershipId = await bootstrapOperatingOrganization(staff.db, { organizationId: operating });

    expect(membershipId).toBe(first.rows[0].id);
    expect(await counts(operating)).toEqual(before);
    expect(before).toMatchObject({ memberships: '1', roles: '1', assignments: '1' });
    expect(await operatingOrganizationId(pg)).toBe(operating);
  });

  it('refuses a different organization once one is designated, and leaves that organization untouched', async () => {
    const claimant = await emptyOrganization('Claimant');

    await expect(bootstrapOperatingOrganization(staff.db, { organizationId: claimant })).rejects.toMatchObject({
      code: 'operating_organization.bootstrap_conflict',
    });
    expect(await operatingOrganizationId(pg)).toBe(operating);
    expect(await counts(claimant)).toMatchObject({ memberships: '0', roles: '0', assignments: '0' });
  });

  it('once designated, leaves a changed Plan alone and still repairs membership', async () => {
    await pg.query(
      `delete from public.organization_plan_assignments
        where organization_id = $1 and plan_id = (select id from public.platform_plans where key = 'gold_internal')`,
      [operating],
    );
    const replacement = await otherPlan();
    await recordPlanAssignment(staff.db, { organizationId: operating, planId: replacement, periodStart: '2000-01-01', periodEnd: '9999-12-31' });
    await pg.query('delete from public.memberships where organization_id = $1 and user_id = $2', [operating, staff.userId]);

    await expect(bootstrapOperatingOrganization(staff.db, { organizationId: operating })).resolves.toBeTruthy();

    expect(await operatingOrganizationId(pg)).toBe(operating);
    const plan = await pg.query<{ plan_id: string }>(
      `select plan_id from public.organization_plan_assignments
        where organization_id = $1 and plan_kind = 'plan' and period_start <= current_date and period_end > current_date`,
      [operating],
    );
    expect(plan.rows).toEqual([{ plan_id: replacement }]);
    expect(await counts(operating)).toMatchObject({ memberships: '1' });
  });

  it('still requires platform staff authority', async () => {
    const outsider = await signedInUser('not-staff');
    const target = await emptyOrganization('Outsider target');

    await expect(bootstrapOperatingOrganization(outsider.db, { organizationId: target })).rejects.toMatchObject({
      code: 'operating_organization.bootstrap_forbidden',
    });
    expect(await operatingOrganizationId(pg)).toBe(operating);
  });
});
