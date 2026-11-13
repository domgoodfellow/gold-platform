import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import {
  getOrganization } from '@/lib/domain/tenancy/organizations';
import { addMember } from '@/lib/domain/tenancy/members';
import { assignRole, createRole, listRoles } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The UI-is-not-authorization rule, upgraded. Before this slice it meant "is there an actor"; these tests assert it now
 * means "may this actor" — and that the answer is enforced by RLS, not only by the domain
 * layer, so a direct RPC call gets the same refusal a form does.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Actor = { db: SupabaseClient; userId: string; email: string };

let owner: Actor;
let organizationId: string;
let ownerMembershipId: string;

async function signUp(label: string): Promise<Actor> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { db, userId: created.user.id, email };
}

let deputy: Awaited<ReturnType<typeof signUp>>;

describe('roles and capabilities', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    owner = await signUp('owner');
    organizationId = await foundBusiness({ ownerEmail: owner.email,
      name: `Roles ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      currency: 'EUR',
    });

    const { data } = await owner.db
      .from('memberships')
      .select('id')
      .eq('organization_id', organizationId)
      .single();
    ownerMembershipId = data!.id as string;
  });

  it('gives the founder a role that is data, not an enum', async () => {
    const roles = await listRoles(owner.db, { organizationId });
    expect(roles).toHaveLength(1);
    expect(roles[0].name).toBe('Admin');
    expect(roles[0].capabilities.slice().sort()).toEqual([...CAPABILITIES].sort());
  });

  it('accepts every capability the code declares', async () => {
    // Guards against the TypeScript list drifting ahead of the check constraint: a
    // capability the UI offers but the database rejects is a promise the system breaks.
    const id = await createRole(owner.db, {
      organizationId,
      name: 'Everything',
      capabilities: [...CAPABILITIES],
    });
    expect(id).toBeTypeOf('string');
  });

  it('refuses a capability that does not exist', async () => {
    await expect(
      createRole(owner.db, {
        organizationId,
        name: 'Impossible',
        capabilities: ['customer.destroy' as never],
      }),
    ).rejects.toMatchObject({ code: 'roles.capability_unknown' });
  });

  it('refuses two roles with the same name in one tenant', async () => {
    await expect(
      createRole(owner.db, { organizationId, name: 'admin', capabilities: [] }),
    ).rejects.toMatchObject({ code: 'roles.name_taken' });
  });

  it('lets two tenants each have a role of the same name', async () => {
    const other = await signUp('other');
    const otherOrganizationId = await foundBusiness({ ownerEmail: other.email, name: 'Other Ltd', displayName: 'Founder', currency: 'EUR' });

    // Both organizations now hold a role called Admin. If roles_org_name_unique had lost
    // its leading organization_id, the second create_organization would already have failed.
    const mine = await listRoles(owner.db, { organizationId });
    const theirs = await listRoles(other.db, { organizationId: otherOrganizationId });

    expect(mine.some((r) => r.name === 'Admin')).toBe(true);
    expect(theirs.some((r) => r.name === 'Admin')).toBe(true);
  });

  it('enforces the capability in the database, not just the domain', async () => {
    // A role that can do nothing, assigned to the only member. From here the owner should
    // be refused by RLS even though they are still a member of the organization.
    const powerless = await createRole(owner.db, {
      organizationId,
      name: 'Observer',
      capabilities: [],
    });

    // But not while they are the last person who can manage roles.
    await expect(
      assignRole(owner.db, { membershipId: ownerMembershipId, roleId: powerless }),
    ).rejects.toMatchObject({ code: 'roles.last_manager' });
  });

  it('lets a member keep role.manage while losing customer.create', async () => {
    const managerOnly = await createRole(owner.db, {
      organizationId,
      name: 'Manager Only',
      capabilities: ['role.manage'],
    });

    // A second administrator, added while the owner still holds everything. Once the owner steps
    // down, only somebody who holds a permission can give it back.
    deputy = await signUp('deputy');
    const everything = (await listRoles(owner.db, { organizationId })).find((r) => r.name === 'Everything')!;
    await addMember(owner.db, { organizationId, email: deputy.email, displayName: 'Deputy', roleId: everything.id });

    await assignRole(owner.db, { membershipId: ownerMembershipId, roleId: managerOnly });

    const organization = await getOrganization(owner.db, organizationId);
    expect(organization!.capabilities).toEqual(['role.manage']);

    // The capability check is in customers_insert, so this is RLS refusing, not TypeScript.
    await expect(
      createCustomer(owner.db, {
        organizationId,
        name: 'Should Not Exist',
        email: `nope-${randomUUID().slice(0, 8)}@example.test`,
      }),
    ).rejects.toMatchObject({ code: 'customers.create_failed' });
  });

  it('cannot hand itself back what it gave up, and has the ability again once somebody who may restores it', async () => {
    const roles = await listRoles(owner.db, { organizationId });
    const everything = roles.find((r) => r.name === 'Everything')!;

    // Holding only role.manage, the member may not move themselves onto a role that holds more.
    await expect(
      assignRole(owner.db, { membershipId: ownerMembershipId, roleId: everything.id }),
    ).rejects.toMatchObject({ code: 'roles.grant_beyond_own' });

    // The second administrator, who holds everything, gives it back.
    await assignRole(deputy.db, { membershipId: ownerMembershipId, roleId: everything.id });

    await expect(
      createCustomer(owner.db, {
        organizationId,
        name: 'Now Allowed',
        email: `yes-${randomUUID().slice(0, 8)}@example.test`,
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('refuses assigning a role that belongs to another organization', async () => {
    // The composite foreign key `memberships_role_same_org` is what actually refuses this —
    // `assignRole`'s own RLS-backed update happily reaches the owner's own membership, and it is
    // the role id naming a row that does not exist for *this* organization that fails.
    const stranger = await signUp('stranger');
    const strangerOrganizationId = await foundBusiness({
      ownerEmail: stranger.email,
      name: `Stranger ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      currency: 'EUR',
    });
    const strangerRoles = await listRoles(stranger.db, { organizationId: strangerOrganizationId });

    await expect(
      assignRole(owner.db, { membershipId: ownerMembershipId, roleId: strangerRoles[0].id }),
    ).rejects.toMatchObject({ code: 'roles.role_not_found' });
  });

  it('refuses role management to someone without the capability', async () => {
    const outsider = await signUp('outsider');
    await expect(
      createRole(outsider.db, {
        organizationId,
        name: 'Trojan Role',
        capabilities: ['role.manage'],
      }),
    ).rejects.toMatchObject({ code: 'roles.forbidden' });
  });

  it('records role changes on the timeline', async () => {
    const { data, error } = await owner.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', organizationId)
      .in('action', ['role.created', 'membership.role_assigned']);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    // Every change names whoever made it: the owner, or the second administrator who gave the owner's role back.
    for (const event of data!) {
      expect([owner.userId, deputy.userId]).toContain(event.actor_id);
    }
    expect(data!.filter((event) => event.actor_id === deputy.userId)).toEqual([{ action: 'membership.role_assigned', actor_id: deputy.userId }]);
  });
});
