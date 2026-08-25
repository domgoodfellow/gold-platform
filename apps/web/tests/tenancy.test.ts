import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';

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

async function signUp(email: string): Promise<{ db: SupabaseClient; userId: string }> {
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

  return { db, userId: created.user.id };
}

describe('tenant isolation', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error(
        'SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set. Run `pnpm db:start` ' +
          'and export the keys it prints, or source infra/.env.test.',
      );
    }

    const run = randomUUID().slice(0, 8);
    const a = await signUp(`alice-${run}@example.test`);
    const b = await signUp(`bob-${run}@example.test`);

    // Both tenants are created with the SAME name, in the same table, in the same database.
    // If either of these fails, a unique index is missing its leading tenant column (I2).
    const { data: aOrg, error: aError } = await a.db.rpc('create_organization', {
      p_name: COLLIDING_NAME,
      p_role: 'owner',
    });
    expect(aError).toBeNull();

    const { data: bOrg, error: bError } = await b.db.rpc('create_organization', {
      p_name: COLLIDING_NAME,
      p_role: 'owner',
    });
    expect(bError).toBeNull();

    alice = { db: a.db, userId: a.userId, organizationId: aOrg as string };
    bob = { db: b.db, userId: b.userId, organizationId: bOrg as string };

    // Alice in a second organization. Proves memberships_org_user_unique leads with
    // organization_id: were it (user_id, organization_id), this would collide.
    const { data: aSecond, error: aSecondError } = await a.db.rpc('create_organization', {
      p_name: 'Alice Overflow Ltd',
      p_role: 'owner',
    });
    expect(aSecondError).toBeNull();
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
    expect(data!.length).toBe(2); // one per organization Alice created
    for (const event of data!) {
      expect(event.actor_id).toBe(alice.userId);
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
      p_role: 'owner',
    });

    expect(error).not.toBeNull();
  });
});
