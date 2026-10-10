import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { FOUNDING_ROLE } from '@/lib/domain/tenancy/organizations';
import { bootstrapGoldInternalWorkspace } from '@/lib/domain/tenancy/gold-internal';
import { asPlatformStaff } from '@/tests/support/founding';

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

// GOLD Internal has one current holder, and this file proves the door refuses a second — so the
// holder it creates must not outlive it, or the next run (and `catalogue-plans`) meets it.
const bootstrapped: string[] = [];

afterAll(async () => {
  if (bootstrapped.length === 0) return;
  const pg = new Client(CONNECTION);
  await pg.connect();
  try {
    await pg.query(
      `delete from public.organization_plan_assignments
        where organization_id = any($1::uuid[])
          and plan_id = (select id from public.platform_plans where key = 'gold_internal')`,
      [bootstrapped],
    );
  } finally {
    await pg.end();
  }
});

describe('bootstrap_gold_internal_workspace', () => {
  it('creates a real GOLD membership with canonical founding authority', async (context) => {
    // GOLD Internal has exactly one current holder. A database that already has one (a seeded demo,
    // an earlier GOLD workspace) cannot give this test a second, and removing the holder would be
    // destroying someone's workspace — so say so and stand aside; a clean database runs it.
    const probe = new Client(CONNECTION);
    await probe.connect();
    const held = await probe.query(
      `select 1 from public.organization_plan_assignments a
         join public.platform_plans p on p.id = a.plan_id
        where p.key = 'gold_internal' and a.period_end >= current_date limit 1`,
    );
    await probe.end();
    if (held.rowCount) context.skip('GOLD Internal already has a holder in this database; run against a clean database.');
    const staff = await asPlatformStaff();
    const user = await staff.auth.getUser();
    const actorId = user.data.user?.id;
    expect(actorId).toBeTruthy();

    const pg = new Client(CONNECTION);
    await pg.connect();

    const orgId = randomUUID();
    const customerOrgId = randomUUID();
    await pg.query(
      `insert into public.organizations (id, name, timezone, currency, created_by)
       values ($1, $2, 'UTC', 'USD', $3),
              ($4, $5, 'UTC', 'USD', $3)`,
      [orgId, `GOLD bootstrap ${randomUUID().slice(0, 8)}`, actorId, customerOrgId, 'Customer untouched'],
    );

    bootstrapped.push(orgId);
    const membershipId = await bootstrapGoldInternalWorkspace(staff, { organizationId: orgId });
    expect(membershipId).toBeTruthy();

    const result = await pg.query<{
      membership_user_id: string;
      membership_organization_id: string;
      role_name: string;
      capabilities: string[];
      plan_key: string;
      customer_memberships: string;
      platform_staff_rows: string;
    }>(
      `select
         m.user_id::text as membership_user_id,
         m.organization_id::text as membership_organization_id,
         r.name as role_name,
         r.capabilities,
         pp.key as plan_key,
         (
           select count(*)::text
             from public.memberships cm
            where cm.organization_id = $2
              and cm.user_id = $3
         ) as customer_memberships,
         (
           select count(*)::text
             from public.platform_staff ps
            where ps.user_id = $3
         ) as platform_staff_rows
       from public.memberships m
       join public.roles r on r.id = m.role_id and r.organization_id = m.organization_id
       join public.organization_plan_assignments opa
         on opa.organization_id = m.organization_id
        and opa.plan_kind = 'plan'
        and opa.period_start <= current_date
        and opa.period_end > current_date
       join public.platform_plans pp on pp.id = opa.plan_id
      where m.id = $1`,
      [membershipId, customerOrgId, actorId],
    );

    await pg.end();

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.membership_user_id).toBe(actorId);
    expect(row.membership_organization_id).toBe(orgId);
    expect(row.role_name).toBe(FOUNDING_ROLE);
    expect(new Set(row.capabilities)).toEqual(new Set(ALL_CAPABILITIES));
    expect(row.capabilities).toEqual(expect.arrayContaining([
      'organization.manage',
      'role.manage',
      'customer.create',
      'work_item.create',
      'integration.manage',
      'feature.manage',
      'billing.manage',
    ]));
    expect(row.plan_key).toBe('gold_internal');
    expect(row.customer_memberships).toBe('0');
    expect(row.platform_staff_rows).toBe('1');
  });

  it('still requires platform staff authority', async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `not-staff-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;

    const db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;

    await expect(bootstrapGoldInternalWorkspace(db, { organizationId: randomUUID() })).rejects.toMatchObject({
      code: 'gold_internal.bootstrap_forbidden',
    });
  });
});
