import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The M1 milestone test.
 *
 * Two organizations in one database, each with its own user, and no query, index, or
 * constraint belonging to one can observe or block the other. Everything here runs under a
 * real signed-in user's JWT — never the service-role key, except to mint the two users,
 * because a service-role client bypasses RLS and would prove nothing at all.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const COLLIDING_NAME = 'Identical Operations Ltd';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
};

let alice: Tenant;
let bob: Tenant;
let aliceSecondOrganizationId: string;

async function signUp(email: string): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const password = `pw-${randomUUID()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
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

  return { db, userId: created.user.id, email };
}

describe('tenant isolation', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error(
        'SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set. Run `pnpm db:start` ' +
          'and export the keys it prints, or source .env.test.',
      );
    }

    const run = randomUUID().slice(0, 8);
    const a = await signUp(`alice-${run}@example.test`);
    const b = await signUp(`bob-${run}@example.test`);

    // Both tenants are created with the SAME name, in the same table, in the same database.
    // If either of these fails, a unique index is missing its leading tenant column (I2).
    const aOrg = await foundBusiness({
      ownerEmail: a.email,
      name: COLLIDING_NAME,
      displayName: 'Founder',
      currency: 'EUR',
    });

    const bOrg = await foundBusiness({
      ownerEmail: b.email,
      name: COLLIDING_NAME,
      displayName: 'Founder',
      currency: 'EUR',
    });

    alice = { db: a.db, userId: a.userId, organizationId: aOrg as string };
    bob = { db: b.db, userId: b.userId, organizationId: bOrg as string };

    // Alice in a second organization. Proves memberships_org_user_unique leads with
    // organization_id: were it (user_id, organization_id), this would collide.
    const aSecond = await foundBusiness({
      ownerEmail: a.email,
      name: 'Alice Overflow Ltd',
      displayName: 'Founder',
      currency: 'EUR',
    });
    aliceSecondOrganizationId = aSecond as string;
  });

  it('gives each tenant a distinct organization despite identical names (I2)', () => {
    expect(alice.organizationId).not.toEqual(bob.organizationId);
  });

  it('lets one user hold memberships in two organizations (I2)', async () => {
    const { data, error } = await alice.db.from('memberships').select('organization_id');
    expect(error).toBeNull();
    const ids = (data ?? []).map((row) => row.organization_id).sort();
    expect(ids).toEqual([alice.organizationId, aliceSecondOrganizationId].sort());
  });

  it('shows each user only their own organizations (I1, I3)', async () => {
    const forAlice = await listMyOrganizations(alice.db);
    const forBob = await listMyOrganizations(bob.db);

    expect(forAlice.map((organization) => organization.id).sort()).toEqual(
      [alice.organizationId, aliceSecondOrganizationId].sort(),
    );
    expect(forBob.map((organization) => organization.id)).toEqual([bob.organizationId]);
  });

  it('hides the other tenant even when its id is known (I1)', async () => {
    const { data, error } = await alice.db
      .from('organizations')
      .select('id')
      .eq('id', bob.organizationId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('records an attributable creation event per tenant (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('organization_id, actor_id, action, entity_type');

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.length).toBe(2); // one per organization Alice was handed

    // **The actor is whoever acted, and since D29 closed founding that is GOLD** — these
    // businesses were provisioned rather than founded by Alice. I11 is unchanged and is what
    // this asserts: every state change names a real `auth.users` id. What it must *not* be is
    // Alice, because she did not do it, and an event that credits the wrong person is worse
    // than one that credits somebody the tenant cannot look up.
    for (const event of data!) {
      expect(event.actor_id).toBeTruthy();
      expect(event.actor_id).not.toBe(alice.userId);
      expect(event.action).toBe('organization.created');
      expect(event.entity_type).toBe('organization');
      expect([alice.organizationId, aliceSecondOrganizationId]).toContain(event.organization_id);
    }
  });

  it('refuses to write an event into another tenant (I1)', async () => {
    const { error } = await alice.db.from('events').insert({
      organization_id: bob.organizationId,
      actor_id: alice.userId,
      entity_type: 'organization',
      entity_id: bob.organizationId,
      action: 'organization.tampered',
    });

    expect(error).not.toBeNull();
  });

  it('refuses to attribute an event to someone else (I11)', async () => {
    const { error } = await alice.db.from('events').insert({
      organization_id: alice.organizationId,
      actor_id: bob.userId,
      entity_type: 'organization',
      entity_id: alice.organizationId,
      action: 'organization.impersonated',
    });

    expect(error).not.toBeNull();
  });

  it('keeps events append-only', async () => {
    const updated = await alice.db
      .from('events')
      .update({ action: 'rewritten' })
      .eq('organization_id', alice.organizationId)
      .select();
    expect(updated.data ?? []).toEqual([]);

    const deleted = await alice.db
      .from('events')
      .delete()
      .eq('organization_id', alice.organizationId)
      .select();
    expect(deleted.data ?? []).toEqual([]);
  });

  it('refuses an unauthenticated caller (I12)', async () => {
    const anonymous = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await anonymous.rpc('create_organization', {
      p_name: 'Ghost Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Founder',
    p_timezone: 'UTC',
    p_currency: 'EUR',
    });

    expect(error).not.toBeNull();
  });

  it('refuses an anonymous session, which is a caller with a real uid (D22)', async () => {
    // The test above passes because there is no session at all. This one is the case that
    // arrived with booking and was not noticed: `signInAnonymously` produces a genuine
    // `auth.users` row and a genuine `auth.uid()` -- deliberately, because that is what kept
    // I11 and D17 intact when D22 was answered -- and it carries `role: authenticated` in its
    // JWT exactly as a registered user does. `create_organization` gated on `auth.uid() is not
    // null` and therefore let it through.
    //
    // **Two guards stand here now and the outer one arrived second.** D29 revoked this
    // function from `authenticated` outright, so an anonymous caller is refused for the same
    // reason every caller is: no grant. The `is_anonymous` check inside is still there, still
    // correct, and now unreachable from any session -- which is why this test asserts the
    // outer refusal and `provisioning.test.ts` asserts the inner rule at the door that is
    // actually open. Deleting either would leave the other, and neither alone is the whole
    // guarantee.
    const visitor = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await visitor.auth.signInAnonymously();
    expect(signInError).toBeNull();

    // Asserted rather than assumed: without this the test would pass for the same reason the
    // one above it does, and would keep passing if the guard were deleted.
    const { data: session } = await visitor.auth.getUser();
    expect(session.user?.id).toBeTruthy();
    expect(session.user?.is_anonymous).toBe(true);

    const { error } = await visitor.rpc('create_organization', {
      p_name: 'Ghost Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Founder',
      p_timezone: 'UTC',
      p_currency: 'EUR',
    });

    // The message, not merely a failure: `expect(error).not.toBeNull()` would also be
    // satisfied by a missing parameter or a renamed column, so it would keep passing on the
    // day the guard stopped being the thing doing the refusing. It reads `permission denied`
    // rather than the anonymous message because the revoked grant is the outer guard now.
    // **The guard inside the function is what refuses now, and that is the point of never
    // having dropped it.** While self-serve founding was closed, the missing grant refused this
    // first and the guard was unreachable — which is why the closing migration said out loud
    // that dropping the function would throw away something found the expensive way. Founding is
    // open to a registered account again; an anonymous session from the booking flow arrives on
    // the same `authenticated` role and is stopped by the guard, exactly as intended.
    expect(error?.message).toContain('anonymous session may not create an organization');
  });
});
