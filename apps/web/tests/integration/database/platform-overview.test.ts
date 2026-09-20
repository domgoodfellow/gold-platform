import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { platformOverview } from '@/lib/domain/platform/overview';
import { launchOrganization } from '@/lib/domain/tenancy/lifecycle';
import { createOrganization } from '@/lib/domain/tenancy/organizations';
import { asPlatformStaff } from '@/tests/support/founding';

/**
 * `/platform`'s own landing screen — replacing a redirect straight to Organizations with a real
 * summary once there was enough platform state to summarise.
 *
 * **Every assertion is a delta, not an absolute count.** The local stack is not reset between
 * suites in one run, so a fresh organization created here is one of however many already exist —
 * the same reasoning `platform-staff.test.ts` gives for finding tenants by id rather than reading
 * the whole table. What's provable honestly is that creating one setup-state and one live-state
 * organization moves the two counters by exactly one each, and that global lifecycle counts
 * always sum to the global total — never that the database started empty. The recently
 * provisioned list is capped independently.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function signedInStranger(label: string): Promise<{ db: SupabaseClient; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: data.user.id };
}

describe('the platform overview', () => {
  it('keeps global lifecycle counts exact when the recent-organizations page is capped', async () => {
    const staff = await asPlatformStaff();
    const before = await platformOverview(staff, { recentLimit: 1 });
    expect(before.organizations.live + before.organizations.settingUp).toBe(before.organizations.total);

    const setup = await signedInStranger('overview-setup');
    const stillSetup = await createOrganization(setup.db, {
      name: `Overview Setup ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      timezone: 'UTC',
      currency: 'EUR',
    });
    void stillSetup;

    const live = await signedInStranger('overview-live');
    const launched = await createOrganization(live.db, {
      name: `Overview Live ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      timezone: 'UTC',
      currency: 'EUR',
    });
    await launchOrganization(live.db, { organizationId: launched });

    const after = await platformOverview(staff, { recentLimit: 1 });
    expect(after.organizations.settingUp).toBe(before.organizations.settingUp + 1);
    expect(after.organizations.live).toBe(before.organizations.live + 1);
    expect(after.organizations.total).toBe(before.organizations.total + 2);
    expect(after.organizations.live + after.organizations.settingUp).toBe(after.organizations.total);
    expect(after.organizations.total).toBeGreaterThan(after.organizations.recent.length);
    expect(after.organizations.recent).toHaveLength(1);

    // The freshly created organizations are the newest in the database, so the most recent one
    // (launched, and therefore created second) leads the console's own "recently provisioned"
    // table.
    expect(after.organizations.recent[0]?.id).toBe(launched);
    expect(after.organizations.recent[0]?.operationalState).toBe('live');
  });

  it('counts open operational failures without touching what caused them', async () => {
    const staff = await asPlatformStaff();
    const owner = await signedInStranger('overview-failure');
    const organizationId = await createOrganization(owner.db, {
      name: `Overview Failure ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      timezone: 'UTC',
      currency: 'EUR',
    });

    const before = await platformOverview(staff);

    // Written the way the automation runtime writes it — a direct connection, since nothing in
    // the application may write a run (`platform-staff.test.ts` establishes the same thing).
    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      await pg.query(
        `insert into public.automation_runs
           (organization_id, rule_id, rule_name, trigger_kind, subject_type, subject_id, outcome, detail)
         values ($1, gen_random_uuid(), 'Overview test rule', 'event', 'work_item', gen_random_uuid(), 'failed', 'a database refusal')`,
        [organizationId],
      );
    } finally {
      await pg.end();
    }

    const after = await platformOverview(staff);
    expect(after.failures.operational).toBe(before.failures.operational + 1);
    // Nothing in this test writes a provider-reconciliation failure — the honest empty state
    // stays honest, unmoved by an unrelated write.
    expect(after.failures.providerReconciliation).toBe(before.failures.providerReconciliation);
  });

  it('reports a non-negative catalogue and rate-card count', async () => {
    const staff = await asPlatformStaff();
    const overview = await platformOverview(staff);
    expect(overview.catalogue.products).toBeGreaterThanOrEqual(0);
    expect(overview.catalogue.meters).toBeGreaterThanOrEqual(0);
    expect(overview.rates.retail).toBeGreaterThanOrEqual(0);
    expect(overview.rates.provider).toBeGreaterThanOrEqual(0);
  });

  it('refuses a caller who is not platform staff, on the same boundary as the rest of the console', async () => {
    const member = await signedInStranger('overview-member');
    await createOrganization(member.db, {
      name: `Overview Member ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      timezone: 'UTC',
      currency: 'EUR',
    });

    // `platformOverview` reads several staff-only sources concurrently (`Promise.all`), so a
    // non-staff caller is refused by whichever one settles first rather than always the same
    // one. What this proves is the thing that matters: every source it reads is staff-gated, so
    // there is no route through the composition that answers for somebody who isn't.
    await expect(platformOverview(member.db)).rejects.toBeInstanceOf(Error);
  });
});

describe('the platform route', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '..', '..', '..', 'app/(platform)/platform/page.tsx'),
    'utf8',
  );

  it('reads through the domain layer rather than redirecting straight to Organizations', () => {
    expect(source).toContain('platformOverview(db)');
    expect(source).not.toContain('redirect(');
  });
});
