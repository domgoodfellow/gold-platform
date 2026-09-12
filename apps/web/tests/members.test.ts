import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import { addMember, listMembers } from '@/lib/domain/tenancy/members';
import {
  getOrganization,
  listMyOrganizations,
} from '@/lib/domain/tenancy/organizations';
import { createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';

/**
 * A second person in an organization — the thing that was impossible until this slice.
 *
 * Everything about roles and capabilities has until now been tested with one member
 * reassigning their own role, which is the shape that was available rather than the shape
 * that matters. These tests are the first where a capability is denied to somebody who is
 * genuinely a different person, and where a tenant boundary separates two humans rather than
 * two rows created by the same human.
 *
 * D19 bounds what this may be: a membership against an existing `auth.users` id. Not an
 * invitation, not a profile. The display name is per-tenant on purpose, and one test asserts
 * exactly that — the same account is called different things in two organizations, and
 * neither learns anything about the other.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Person = { db: SupabaseClient; userId: string; email: string };

let owner: Person;
let staff: Person;
let stranger: Person;
let organizationId: string;
let otherOrganizationId: string;
let staffRoleId: string;

async function signUp(label: string): Promise<Person> {
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

describe('members', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    owner = await signUp('mem-owner');
    staff = await signUp('mem-staff');
    stranger = await signUp('mem-stranger');

    organizationId = await foundBusiness({ ownerEmail: owner.email,
      name: `Members ${randomUUID().slice(0, 6)}`,
      displayName: 'Dominic',
      currency: 'EUR',
    });

    // A role that can do the day job but cannot manage people or roles.
    staffRoleId = await createRole(owner.db, {
      organizationId,
      name: 'Technician',
      capabilities: ['customer.create'],
    });

    otherOrganizationId = await foundBusiness({ ownerEmail: stranger.email,
      name: `Other ${randomUUID().slice(0, 6)}`,
      displayName: 'Someone Else',
      currency: 'EUR',
    });
  });

  it('names the founder rather than calling them Member', async () => {
    const members = await listMembers(owner.db, { organizationId });
    expect(members).toHaveLength(1);
    expect(members[0].displayName).toBe('Dominic');
    expect(members[0].userId).toBe(owner.userId);
  });

  it('adds a second person to an organization', async () => {
    const id = await addMember(owner.db, {
      organizationId,
      email: staff.email,
      displayName: 'Sam',
      roleId: staffRoleId,
    });
    expect(id).toBeTypeOf('string');

    const members = await listMembers(owner.db, { organizationId });
    expect(members.map((m) => m.displayName)).toEqual(['Dominic', 'Sam']);
  });

  it('lets the new person see the organization as their own', async () => {
    // The whole point. Before this slice a second person could never reach a tenant at all.
    const organization = await getOrganization(staff.db, organizationId);
    expect(organization?.name).toContain('Members');
    expect(organization?.role).toBe('Technician');
    expect(organization?.capabilities).toEqual(['customer.create']);
  });

  it('lists the organization once per person, not once per membership', async () => {
    // The regression this slice exposed. `listMyOrganizations` selected every membership RLS
    // allowed, which is every membership in the caller's organizations — correct only while
    // an organization could have exactly one member. With two, each person saw the same
    // organization twice, one of them carrying a colleague's role and capabilities.
    const mine = await listMyOrganizations(owner.db);
    const theirs = await listMyOrganizations(staff.db);

    expect(mine.filter((o) => o.id === organizationId)).toHaveLength(1);
    expect(theirs.filter((o) => o.id === organizationId)).toHaveLength(1);
    expect(mine.find((o) => o.id === organizationId)?.role).toBe('Admin');
    expect(theirs.find((o) => o.id === organizationId)?.role).toBe('Technician');
  });

  it('matches an address case-insensitively', async () => {
    const other = await signUp('mem-case');
    const id = await addMember(owner.db, {
      organizationId,
      email: other.email.toUpperCase(),
      displayName: 'Upper Case',
      roleId: staffRoleId,
    });
    expect(id).toBeTypeOf('string');
  });

  it('refuses to add the same person twice', async () => {
    await expect(
      addMember(owner.db, {
        organizationId,
        email: staff.email,
        displayName: 'Sam Again',
        roleId: staffRoleId,
      }),
    ).rejects.toMatchObject({ code: 'members.already_member' });
  });

  it('refuses an address with no account, rather than inventing one', async () => {
    // D19: this is not an invitation system. Someone without an account signs up first.
    await expect(
      addMember(owner.db, {
        organizationId,
        email: `nobody-${randomUUID().slice(0, 8)}@example.test`,
        displayName: 'Ghost',
        roleId: staffRoleId,
      }),
    ).rejects.toMatchObject({ code: 'members.no_account' });
  });

  it('denies a capability to a genuinely different person (I12)', async () => {
    // Until this slice every capability denial was one member reassigning their own role.
    // Sam holds customer.create and not role.manage, and is refused by RLS.
    await expect(
      createRole(staff.db, {
        organizationId,
        name: 'Sneaky',
        capabilities: ['role.manage'],
      }),
    ).rejects.toMatchObject({ code: 'roles.forbidden' });

    await expect(
      addMember(staff.db, {
        organizationId,
        email: stranger.email,
        displayName: 'Trojan',
        roleId: staffRoleId,
      }),
    ).rejects.toMatchObject({ code: 'members.forbidden' });
  });

  it('lets that person do what their role does allow', async () => {
    // Non-vacuity: the refusals above are about the capability, not about Sam being unable
    // to do anything at all.
    const id = await createCustomer(staff.db, {
      organizationId,
      name: 'Added By Sam Ltd',
    });
    expect(id).toBeTypeOf('string');

    // And the owner sees it, because they are in the same tenant.
    const customers = await listCustomers(owner.db, { organizationId });
    expect(customers.some((c) => c.name === 'Added By Sam Ltd')).toBe(true);
  });

  it('keeps two people in one tenant separate from a third outside it', async () => {
    const outside = await getOrganization(stranger.db, organizationId);
    expect(outside).toBeNull();

    const theirs = await listMembers(stranger.db, { organizationId });
    expect(theirs).toEqual([]);
  });

  it('cannot add someone to an organization the caller is not in', async () => {
    await expect(
      addMember(stranger.db, {
        organizationId,
        email: staff.email,
        displayName: 'Trojan',
        roleId: staffRoleId,
      }),
    ).rejects.toMatchObject({ code: 'members.forbidden' });
  });

  it('cannot give a member a role belonging to another organization (I18)', async () => {
    await expect(
      addMember(owner.db, {
        organizationId,
        email: stranger.email,
        displayName: 'Borrowed Role',
        roleId: (await firstRoleId(stranger.db, otherOrganizationId)),
      }),
    ).rejects.toMatchObject({ code: 'members.role_not_found' });
  });

  it('calls the same account different things in different tenants (D19)', async () => {
    // Sam is "Sam" here. In the stranger's organization the same account is "Contractor",
    // and neither tenant can see the other's name for them — there is no profile to share.
    const otherRole = await firstRoleId(stranger.db, otherOrganizationId);
    await addMember(stranger.db, {
      organizationId: otherOrganizationId,
      email: staff.email,
      displayName: 'Contractor',
      roleId: otherRole,
    });

    const here = await listMembers(owner.db, { organizationId });
    const there = await listMembers(stranger.db, { organizationId: otherOrganizationId });

    expect(here.find((m) => m.userId === staff.userId)?.displayName).toBe('Sam');
    expect(there.find((m) => m.userId === staff.userId)?.displayName).toBe('Contractor');
  });

  it('records a new membership on the timeline (I11)', async () => {
    const { data, error } = await owner.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', organizationId)
      .eq('action', 'membership.created');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const event of data!) {
      expect(event.actor_id).toBe(owner.userId);
    }
  });
});

async function firstRoleId(db: SupabaseClient, organizationId: string): Promise<string> {
  const { data, error } = await db
    .from('roles')
    .select('id')
    .eq('organization_id', organizationId)
    .limit(1)
    .single();
  if (error) throw error;
  return data.id as string;
}
