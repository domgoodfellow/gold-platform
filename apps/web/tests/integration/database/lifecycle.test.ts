import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import {
  computeReadiness,
  computeSetupOverview,
  launchOrganization,
} from '@/lib/domain/tenancy/lifecycle';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createOrganization, getOrganization } from '@/lib/domain/tenancy/organizations';
import { asPlatformStaff, foundBusiness, newAccountEmail } from '@/tests/support/founding';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';

/**
 * ORGANIZATION CREATED → SETUP → BUSINESS SETUP OVERVIEW → COMPUTED READINESS →
 * DELIBERATE LAUNCH → LIVE.
 *
 * **Readiness is a read, never a write.** Every assertion below that touches `computeReadiness`
 * changes something about the business first (a module switched on, then off) and reads the
 * function again rather than reading a stored flag — there is no flag, on purpose, for the same
 * reason the one-calculation rule and the single availability model refuse a second price or a second availability calculation one level up.
 *
 * **A solo tenant with nothing configured is a valid business.** The suite proves the negative
 * space as carefully as the positive: a fresh organization with no work item type, no second
 * member, no price book, no operating hours, no resource and no location carries zero blockers,
 * because none of those is a universal requirement — only a module the business actually
 * switched on may contribute one, and only `outstandingModuleSetup`'s own notes ever do.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function signedInStranger(): Promise<{ db: SupabaseClient; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `stranger-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, email };
}

async function freshOrganization(): Promise<{ db: SupabaseClient; organizationId: string }> {
  const { db, email } = await signedInStranger();
  const organizationId = await createOrganization(db, {
    name: `Lifecycle Test ${randomUUID().slice(0, 6)}`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });
  void email;
  return { db, organizationId };
}

async function enableEntitledBooking(db: SupabaseClient, organizationId: string) {
  await recordCommercialTerm(await asPlatformStaff(), { organizationId, productKey: 'module:booking', periodStart: '2020-01-01', periodEnd: '9999-12-31', priceMinor: 0, currency: 'EUR' });
  await setModuleEnabled(db, { organizationId, key: 'booking', enabled: true });
}

describe('a business starts in setup and someone launches it', () => {
  it('begins SETUP the moment it is created, through either door', async () => {
    const { db, organizationId: selfFounded } = await freshOrganization();
    expect((await getOrganization(db, selfFounded))?.operationalState).toBe('setup');

    const ownerEmail = await newAccountEmail('owner');
    const provisioned = await foundBusiness({
      ownerEmail,
      name: 'Provisioned Lifecycle Ltd',
      currency: 'GBP',
    });
    // The owner's own session, not staff's — `getOrganization` for staff already returns null
    // for a tenant they hold no membership in, which this suite is not what is testing.
    const pg = new Client(CONNECTION);
    await pg.connect();
    const { rows } = await pg.query(
      'select operational_state from public.organizations where id = $1',
      [provisioned],
    );
    await pg.end();
    expect(rows[0].operational_state).toBe('setup');
  });

  it('treats a solo, unconfigured tenant as fully valid — zero blockers', async () => {
    const { db, organizationId } = await freshOrganization();

    const readiness = await computeReadiness(db, { organizationId });

    // Billing is on by default and nothing is priced yet, which `outstandingModuleSetup`
    // already notes for Settings — real, and exactly why it is a warning rather than a
    // blocker (decision 5's own example: "no price book" is never a universal blocker).
    expect(readiness.blockers).toEqual([]);
    expect(readiness.warnings.some((item) => item.key === 'billing')).toBe(true);
    expect(readiness.optional).toEqual([]);
  });

  it('derives a blocker from a module actually switched on, and drops it the moment the module is switched off — never a stored flag', async () => {
    const { db, organizationId } = await freshOrganization();

    // Nothing yet — booking is off by default.
    expect((await computeReadiness(db, { organizationId })).blockers).toEqual([]);

    await enableEntitledBooking(db, organizationId);

    // Public booking with no address at all is not "unfinished", it is unreachable — the
    // product reality audit's own example of a real per-module requirement.
    const withBooking = await computeReadiness(db, { organizationId });
    expect(withBooking.blockers.map((item) => item.key)).toEqual(['booking']);
    expect(withBooking.blockers[0].area).toEqual({
      href: `/organizations/${organizationId}/settings/domains#booking-address`,
      label: 'Settings',
    });

    // Refused while the blocker stands — re-checked here, not trusted from the read above.
    await expect(launchOrganization(db, { organizationId })).rejects.toMatchObject({
      code: 'organizations.not_ready',
    });
    expect((await getOrganization(db, organizationId))?.operationalState).toBe('setup');

    // Switching the module back off is a legitimate way to clear the requirement — nothing was
    // "resolved" by hand, and the very next read reflects it, because there is nothing cached
    // to invalidate.
    await setModuleEnabled(db, { organizationId, key: 'booking', enabled: false });
    expect((await computeReadiness(db, { organizationId })).blockers).toEqual([]);
  });

  it('launches once every blocker clears, writing an attributable event', async () => {
    const { db, organizationId } = await freshOrganization();

    await launchOrganization(db, { organizationId });

    expect((await getOrganization(db, organizationId))?.operationalState).toBe('live');

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `select actor_id, action, payload from public.events
          where organization_id = $1 and action = 'organization.launched'`,
        [organizationId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({});
    } finally {
      await pg.end();
    }

    // A second attempt is refused rather than a silent no-op — the direction is one way, and
    // trying again says so rather than pretending to succeed twice.
    await expect(launchOrganization(db, { organizationId })).rejects.toMatchObject({
      code: 'organizations.already_live',
    });
  });

  it('refuses a direct RPC launch from the organization’s own authorized owner while a blocker exists, and allows it once resolved', async () => {
    // **This is the test the previous slice's report was missing.** The unrelated-stranger test
    // below proves the capability grant; it proves nothing about the blocker invariant, because
    // a stranger never gets far enough to test it. This one calls `public.launch_organization`
    // directly — never `launchAction`, never `launchOrganization` — as the one caller who holds
    // exactly the capability the function checks, which is the caller a capability check alone
    // cannot stop.
    const { db, organizationId } = await freshOrganization();
    await enableEntitledBooking(db, organizationId);

    const readiness = await computeReadiness(db, { organizationId });
    expect(readiness.blockers.map((item) => item.key)).toEqual(['booking']);

    // The bypass itself: straight at the RPC, on the owner's own session, which holds
    // `organization.manage` from founding (`ALL_CAPABILITIES`) — precisely the session
    // `launch_organization`'s capability check alone would have let through.
    const blocked = await db.rpc('launch_organization', { p_id: organizationId });
    expect(blocked.error).not.toBeNull();

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      const midway = await pg.query(
        'select operational_state from public.organizations where id = $1',
        [organizationId],
      );
      expect(midway.rows[0].operational_state).toBe('setup');

      await setModuleEnabled(db, { organizationId, key: 'booking', enabled: false });
      expect((await computeReadiness(db, { organizationId })).blockers).toEqual([]);

      // The same direct call, same session, nothing routed through `launchAction` at any point —
      // succeeds now that the database's own predicate agrees there is nothing left blocking it.
      const allowed = await db.rpc('launch_organization', { p_id: organizationId });
      expect(allowed.error).toBeNull();

      const after = await pg.query(
        'select operational_state from public.organizations where id = $1',
        [organizationId],
      );
      expect(after.rows[0].operational_state).toBe('live');

      const events = await pg.query(
        `select actor_id, action from public.events
          where organization_id = $1 and action = 'organization.launched'`,
        [organizationId],
      );
      expect(events.rows).toHaveLength(1);
    } finally {
      await pg.end();
    }
  });

  it('refuses a direct, unauthorized call to the launch function itself', async () => {
    const { organizationId } = await freshOrganization();
    const { db: stranger } = await signedInStranger();

    // Not a member of this organization at all, so `has_capability` inside the function
    // returns false and the write never happens — asserted at the RPC directly, the same way
    // `provisioning.test.ts` proves a grant rather than trusting the TypeScript wrapper alone.
    const { error } = await stranger.rpc('launch_organization', { p_id: organizationId });
    expect(error).not.toBeNull();

    const pg = new Client(CONNECTION);
    await pg.connect();
    const { rows } = await pg.query(
      'select operational_state from public.organizations where id = $1',
      [organizationId],
    );
    await pg.end();
    expect(rows[0].operational_state).toBe('setup');
  });
});

/**
 * THE SETUP COCKPIT'S AREAS. Progress counts finished *areas*, importance is only ever what the
 * database and `computeReadiness` already say, and an optional gap is a gap — never a blocker.
 */
describe('the setup overview — areas, importance and progress', () => {
  it('lists a fresh business’s areas with no blocker, one recommendation and optional kernel gaps', async () => {
    const { db, organizationId } = await freshOrganization();

    const overview = await computeSetupOverview(db, { organizationId });

    expect(overview.blockers).toEqual([]);
    const byKey = new Map(overview.areas.map((area) => [area.key, area]));
    // Billing is on by default and nothing is priced: a real gap, but the database does not block on it.
    expect(byKey.get('billing')).toMatchObject({ state: 'incomplete', importance: 'recommended' });
    // Kernel configuration is never required — a solo tenant with none of it is a valid business.
    expect(byKey.get('work')).toMatchObject({ state: 'incomplete', importance: 'optional' });
    // Resources, hours and locations describe scheduled work, and this business has declared none,
    // so setup does not ask for them — whatever it has or has not recorded.
    for (const key of ['resources', 'hours', 'locations']) expect(byKey.has(key)).toBe(false);
    expect(overview.ready).toBe(0);
    expect(overview.total).toBe(overview.areas.length);
    expect(overview.recommendedOpen).toBe(1);
    expect(overview.optionalOpen).toBe(1);
    // Each area points at the surface that owns it, not at a copy of it.
    expect(byKey.get('work')?.area.href).toBe(`/organizations/${organizationId}/work/configuration`);
    expect(byKey.get('billing')?.area.href).toBe(`/organizations/${organizationId}/finance/configuration/pricing`);
  });

  it('counts an area as ready the moment its real fact is true, and orders required gaps first', async () => {
    const { db, organizationId } = await freshOrganization();

    await createWorkItemType(db, { schedulable: true, organizationId, name: 'Repair' });
    await enableEntitledBooking(db, organizationId);

    const overview = await computeSetupOverview(db, { organizationId });
    const byKey = new Map(overview.areas.map((area) => [area.key, area]));

    expect(byKey.get('work')).toMatchObject({ state: 'complete' });
    expect(overview.ready).toBe(1);
    // A switched-on module the database would refuse a launch for is the one required area.
    expect(overview.blockers.map((area) => area.key)).toEqual(['booking']);
    expect(overview.areas[0]).toMatchObject({ key: 'booking', state: 'incomplete', importance: 'required' });
    // Finished areas sort last.
    expect(overview.areas[overview.areas.length - 1].state).toBe('complete');
  });

  it('agrees with what Launch actually refuses — blockers here are exactly the ones the database names', async () => {
    const { db, organizationId } = await freshOrganization();
    await enableEntitledBooking(db, organizationId);

    const [overview, readiness] = await Promise.all([
      computeSetupOverview(db, { organizationId }),
      computeReadiness(db, { organizationId }),
    ]);
    expect(overview.blockers.map((area) => area.key)).toEqual(readiness.blockers.map((item) => item.key));
    await expect(launchOrganization(db, { organizationId })).rejects.toMatchObject({
      code: 'organizations.not_ready',
    });
  });

  it('launches with a recommendation and every optional area still open', async () => {
    const { db, organizationId } = await freshOrganization();
    const overview = await computeSetupOverview(db, { organizationId });
    expect(overview.recommendedOpen).toBeGreaterThan(0);
    expect(overview.optionalOpen).toBeGreaterThan(0);
    expect(overview.blockers).toEqual([]);

    await launchOrganization(db, { organizationId });
    expect((await getOrganization(db, organizationId))?.operationalState).toBe('live');
  });
});
