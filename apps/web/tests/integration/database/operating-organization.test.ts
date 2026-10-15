import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadOrganizationShellModel } from '@/lib/application/shell/organization-shell';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { projectedItems } from '@/lib/shell';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { createPlan, getPlan } from '@/lib/domain/catalogue/plans';
import {
  bootstrapOperatingOrganization,
  callerOperatingOrganization,
  isOperatingOrganization,
} from '@/lib/domain/platform/operating-organization';
import { requirePlatformArea, requirePlatformCapability, requirePlatformScope } from '@/lib/route/platform';
import { foundBusiness } from '@/tests/support/founding';
import { setAsideOperatingOrganization } from '@/tests/support/operating-organization';

/**
 * GildOps' operating identity end to end: the configured identity, the caller's membership and
 * platform authority are separate facts, and the Platform guards need all three. `getDb` returns
 * whichever signed-in client the test names and `redirect`/`notFound` become thrown values;
 * nothing else about the guards is faked.
 */

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

let currentDb: SupabaseClient;
vi.mock('@/lib/db/server', () => ({ getDb: async () => currentDb }));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const MIGRATION = new URL(
  '../../../../../supabase/migrations/20261221000001_the_operating_organization_is_configured_not_inferred.sql',
  import.meta.url,
);

type Person = { db: SupabaseClient; userId: string; email: string };

async function person(label: string, options: { staff?: boolean } = {}): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  if (options.staff) {
    await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [created.data.user.id, 'Operator']);
  }
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

function as<T>(who: Person, run: () => Promise<T>): Promise<T> {
  currentDb = who.db;
  return run();
}

let pg: Client;
let restore: () => Promise<void>;
let operator: Person;
let outsiderStaff: Person;
let plainMember: Person;
let otherOwner: Person;
let gildops: string;
let otherBusiness: string;
let internalPlanHolder: string;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  restore = await setAsideOperatingOrganization(pg);

  operator = await person('operating-staff', { staff: true });
  gildops = await foundBusiness({ ownerEmail: operator.email, name: `GildOps ${randomUUID().slice(0, 8)}`, currency: 'USD' });
  await bootstrapOperatingOrganization(operator.db, { organizationId: gildops });
  otherBusiness = await foundBusiness({ ownerEmail: operator.email, name: `Operator side business ${randomUUID().slice(0, 8)}`, currency: 'USD' });

  outsiderStaff = await person('staff-no-membership', { staff: true });

  plainMember = await person('gildops-member');
  await pg.query(
    `insert into public.memberships (organization_id, user_id, role_id, created_by)
     select $1, $2, r.id, $3 from public.roles r where r.organization_id = $1 order by r.created_at limit 1`,
    [gildops, plainMember.userId, operator.userId],
  );

  otherOwner = await person('internal-plan-holder', { staff: true });
  internalPlanHolder = await foundBusiness({ ownerEmail: otherOwner.email, name: `Internal plan holder ${randomUUID().slice(0, 8)}`, currency: 'USD' });
  const internal = await getPlan(operator.db, 'gold_internal');
  await recordPlanAssignment(operator.db, { organizationId: internalPlanHolder, planId: internal!.id, periodStart: '2000-01-01', periodEnd: '9999-12-31' });
}, 120_000);

afterAll(async () => {
  try {
    await restore?.();
    await pg.query(
      `delete from public.organization_plan_assignments
        where organization_id = any($1::uuid[])
          and plan_id = (select id from public.platform_plans where key = 'gold_internal')`,
      [[gildops, internalPlanHolder].filter(Boolean)],
    );
  } finally {
    await pg.end();
  }
});

describe('the operating organization and the Platform guards', () => {
  it('admits a staff member who is a member of the operating organization', async () => {
    const scope = await as(operator, () => requirePlatformScope(gildops));
    expect(scope.organization.id).toBe(gildops);
    expect(scope.permissions.size).toBe(5);
    await expect(as(operator, () => requirePlatformArea(gildops, 'platform.health'))).resolves.toBeTruthy();
    await expect(as(operator, () => requirePlatformCapability('platform.commercial'))).resolves.toBe(gildops);
    expect(await callerOperatingOrganization(operator.db)).toEqual({ id: gildops });
    expect((await loadPlatformContext(operator.db, gildops))?.organizationId).toBe(gildops);
  });

  it("refuses another organization's id in a Platform URL, even from that staff member", async () => {
    await expect(as(operator, () => requirePlatformScope(otherBusiness))).rejects.toThrow('NOT_FOUND');
    expect(await isOperatingOrganization(operator.db, { organizationId: otherBusiness })).toBe(false);
    expect(await loadPlatformContext(operator.db, otherBusiness)).toBeNull();
  });

  it('refuses platform staff who are not members of the operating organization, and does not tell them which it is', async () => {
    await expect(as(outsiderStaff, () => requirePlatformScope(gildops))).rejects.toThrow('NOT_FOUND');
    await expect(as(outsiderStaff, () => requirePlatformCapability('platform.health'))).rejects.toMatchObject({
      code: 'platform.capability_denied',
    });
    expect(await callerOperatingOrganization(outsiderStaff.db)).toBeNull();
    expect(await loadPlatformContext(outsiderStaff.db, gildops)).toBeNull();
  });

  it('refuses a member of the operating organization who holds no platform permission', async () => {
    expect(await callerOperatingOrganization(plainMember.db)).toEqual({ id: gildops });
    await expect(as(plainMember, () => requirePlatformScope(gildops))).rejects.toThrow('NOT_FOUND');
    await expect(as(plainMember, () => requirePlatformCapability('platform.health'))).rejects.toMatchObject({
      code: 'platform.capability_denied',
    });
    expect(await loadPlatformContext(plainMember.db, gildops)).toBeNull();
  });

  it('does not make another holder of the internal Plan GildOps', async () => {
    expect(await callerOperatingOrganization(otherOwner.db)).toBeNull();
    expect(await isOperatingOrganization(otherOwner.db, { organizationId: internalPlanHolder })).toBe(false);
    await expect(as(otherOwner, () => requirePlatformScope(internalPlanHolder))).rejects.toThrow('NOT_FOUND');
    expect(await loadPlatformContext(otherOwner.db, internalPlanHolder)).toBeNull();
  });

  it("keeps the identity when GildOps' commercial Plan changes", async () => {
    await pg.query(
      `delete from public.organization_plan_assignments
        where organization_id = $1 and plan_id = (select id from public.platform_plans where key = 'gold_internal')`,
      [gildops],
    );
    const planId = await createPlan(operator.db, {
      key: `plan_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      kind: 'plan',
      label: 'Replacement plan',
      description: '',
      billable: false,
    });
    await recordPlanAssignment(operator.db, { organizationId: gildops, planId, periodStart: '2000-01-01', periodEnd: '9999-12-31' });

    expect(await callerOperatingOrganization(operator.db)).toEqual({ id: gildops });
    await expect(as(operator, () => requirePlatformScope(gildops))).resolves.toBeTruthy();
  });

  it('fails closed when no operating organization is configured', async () => {
    await pg.query('update public.platform_settings set operating_organization_id = null where singleton');
    try {
      expect(await callerOperatingOrganization(operator.db)).toBeNull();
      await expect(as(operator, () => requirePlatformScope(gildops))).rejects.toThrow('NOT_FOUND');
      await expect(as(operator, () => requirePlatformCapability('platform.health'))).rejects.toMatchObject({
        code: 'platform.capability_denied',
      });
      expect(await loadPlatformContext(operator.db, gildops)).toBeNull();
    } finally {
      await pg.query('update public.platform_settings set operating_organization_id = $1 where singleton', [gildops]);
    }
  });
});

describe('Administration in the organization shell', () => {
  const shellOf = (who: Person, organizationId: string, locked = false) =>
    loadOrganizationShellModel(who.db, { organizationId, capabilities: ALL_CAPABILITIES, locked });
  const administrationKeys = async (who: Person, organizationId: string, locked = false) =>
    projectedItems((await shellOf(who, organizationId, locked)).sections)
      .flatMap((item) => [item.key, ...(item.administration ? [item.administration.key] : [])])
      .filter((key) => key === 'administration' || key.startsWith('platform-'))
      .sort();

  it("draws GildOps' Administration for its staff, with GildOps as the organization", async () => {
    const model = await shellOf(operator, gildops);
    expect(await administrationKeys(operator, gildops)).toEqual(['administration', 'platform-link-ai-runtime', 'platform-link-commercial']);
    expect(model.switchable.map((organization) => organization.id)).toEqual(expect.arrayContaining([gildops, otherBusiness]));
    expect(model).not.toHaveProperty('platform');
  });

  it("draws none of it in a customer's shell, even for that staff member", async () => {
    expect(await administrationKeys(operator, otherBusiness)).toEqual([]);
    expect(await administrationKeys(otherOwner, internalPlanHolder)).toEqual([]);
  });

  it('draws none of it for a member of GildOps without a platform permission', async () => {
    expect(await administrationKeys(plainMember, gildops)).toEqual([]);
  });

  it('keeps the Administration entry while GildOps itself is locked', async () => {
    expect(await administrationKeys(operator, gildops, true)).toContain('administration');
  });
});

describe('the operating organization configuration', () => {
  it('is neither readable nor writable by a signed-in client', async () => {
    const read = await operator.db.from('platform_settings').select('operating_organization_id');
    expect(read.error?.code).toBe('42501');
    const write = await operator.db.from('platform_settings').update({ operating_organization_id: otherBusiness }).eq('singleton', true);
    expect(write.error?.code).toBe('42501');
  });

  it('cannot be pointed at another organization in one step, even by a privileged writer', async () => {
    await expect(
      pg.query('update public.platform_settings set operating_organization_id = $1 where singleton', [otherBusiness]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps the operating organization from being deleted out from under it', async () => {
    await pg.query('begin');
    try {
      await expect(pg.query('delete from public.organizations where id = $1', [gildops])).rejects.toMatchObject({ code: '23503' });
    } finally {
      await pg.query('rollback');
    }
  });
});

describe('the migration backfill', () => {
  // The migration's own block, run again inside a transaction that is rolled back.
  const backfill = /do \$\$[\s\S]*?\n\$\$;/.exec(readFileSync(MIGRATION, 'utf8'))?.[0] ?? '';

  async function holders(...organizationIds: string[]) {
    await pg.query(
      `delete from public.organization_plan_assignments
        where plan_id = (select id from public.platform_plans where key = 'gold_internal')`,
    );
    for (const organizationId of organizationIds) {
      await pg.query(
        `delete from public.organization_plan_assignments where organization_id = $1 and plan_kind = 'plan'`,
        [organizationId],
      );
      await pg.query(
        `insert into public.organization_plan_assignments (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by)
         select $1, id, 'plan', '2000-01-01', '9999-12-31', $2 from public.platform_plans where key = 'gold_internal'`,
        [organizationId, operator.userId],
      );
    }
    await pg.query('update public.platform_settings set operating_organization_id = null where singleton');
  }

  async function configured(): Promise<string | null> {
    return (await pg.query('select operating_organization_id as id from public.platform_settings where singleton')).rows[0].id;
  }

  it('is the block the migration runs', () => {
    expect(backfill).toContain("pp.key = 'gold_internal'");
    expect(backfill).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('leaves a database with no holder unconfigured, backfills the one holder, and refuses two', async () => {
    await pg.query('begin');
    try {
      await holders();
      await pg.query(backfill);
      expect(await configured()).toBeNull();

      await holders(otherBusiness);
      await pg.query(backfill);
      expect(await configured()).toBe(otherBusiness);

      await holders(otherBusiness, internalPlanHolder);
      await pg.query('savepoint ambiguous');
      await expect(pg.query(backfill)).rejects.toMatchObject({ code: '23505' });
      await pg.query('rollback to savepoint ambiguous');
      expect(await configured()).toBeNull();
    } finally {
      await pg.query('rollback');
    }
    expect(await configured()).toBe(gildops);
  });
});
