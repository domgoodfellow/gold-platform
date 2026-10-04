import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createResource,
  getResource,
  getResourceForCurrentMember,
  listResources,
  setResourceMembership,
} from '@/lib/domain/resources/resources';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Slice 0B — a schedulable Resource may optionally represent one tenant Membership.
 *
 * The relationship this proves is deliberately narrow: it makes "which Resource represents
 * this Membership" a real, indexable, RLS-visible fact instead of a name/role/custom-field
 * guess. It does not narrow Schedule visibility (still organization-wide — see the last test)
 * and it does not build Teams. `resource.update` is the new authority under test throughout;
 * every assertion below is checked against the capability, never against a role's name — Bob's
 * "Limited" role and Sam's "Full" role are named for what this suite needs, not for the product
 * to recognise.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };

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

async function membershipIdFor(
  db: SupabaseClient,
  organizationId: string,
  userId: string,
): Promise<string> {
  const { data, error } = await db
    .from('memberships')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .single();
  if (error) throw error;
  return data.id as string;
}

let owner: Person;
let colleague: Person;
let restricted: Person;
let extra: Person;
let viewer: Person;
let stranger: Person;

let organizationId: string;
let otherOrganizationId: string;

let colleagueMembershipId: string;
let ownerMembershipId: string;
let restrictedMembershipId: string;
let extraMembershipId: string;
let strangerMembershipId: string;

describe('resource<->membership operational identity (Slice 0B)', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    owner = await signUp('rm-owner');
    colleague = await signUp('rm-colleague');
    restricted = await signUp('rm-restricted');
    extra = await signUp('rm-extra');
    viewer = await signUp('rm-viewer');
    stranger = await signUp('rm-stranger');

    organizationId = await foundBusiness({
      ownerEmail: owner.email,
      name: `RM ${randomUUID().slice(0, 6)}`,
      displayName: 'Owner',
      currency: 'EUR',
    });
    otherOrganizationId = await foundBusiness({
      ownerEmail: stranger.email,
      name: `Other ${randomUUID().slice(0, 6)}`,
      displayName: 'Stranger',
      currency: 'EUR',
    });

    // Named for what this suite needs to prove, not for the product to recognise (I12,
    // restated by role-preset-not-classification.test.ts one layer up): a role called "Full"
    // holds resource.update, a role called "Limited" does not, and nothing anywhere may branch
    // on either name.
    const fullRoleId = await createRole(owner.db, {
      organizationId,
      name: 'Full',
      capabilities: ['resource.create', 'resource.update', 'customer.create'],
    });
    const limitedRoleId = await createRole(owner.db, {
      organizationId,
      name: 'Limited',
      capabilities: ['customer.create'],
    });
    const viewerRoleId = await createRole(owner.db, {
      organizationId,
      name: 'Viewer',
      capabilities: [],
    });

    await addMember(owner.db, {
      organizationId,
      email: colleague.email,
      displayName: 'Colleague',
      roleId: fullRoleId,
    });
    await addMember(owner.db, {
      organizationId,
      email: restricted.email,
      displayName: 'Restricted',
      roleId: limitedRoleId,
    });
    await addMember(owner.db, {
      organizationId,
      email: extra.email,
      displayName: 'Extra',
      roleId: limitedRoleId,
    });
    await addMember(owner.db, {
      organizationId,
      email: viewer.email,
      displayName: 'Viewer',
      roleId: viewerRoleId,
    });

    ownerMembershipId = await membershipIdFor(owner.db, organizationId, owner.userId);
    colleagueMembershipId = await membershipIdFor(owner.db, organizationId, colleague.userId);
    restrictedMembershipId = await membershipIdFor(owner.db, organizationId, restricted.userId);
    extraMembershipId = await membershipIdFor(owner.db, organizationId, extra.userId);
    strangerMembershipId = await membershipIdFor(
      stranger.db,
      otherOrganizationId,
      stranger.userId,
    );
  });

  it('1. may exist with no linked member', async () => {
    const id = await createResource(owner.db, { organizationId, name: 'Van 1' });
    const resource = await getResource(owner.db, { organizationId, resourceId: id });
    expect(resource?.member).toBeNull();
  });

  let colleagueResourceId: string;

  it('2. links to a Membership from the same organization', async () => {
    colleagueResourceId = await createResource(owner.db, {
      organizationId,
      name: 'Van 9', // deliberately unrelated to "Colleague" — see test 13.
      membershipId: colleagueMembershipId,
    });
    const resource = await getResource(owner.db, { organizationId, resourceId: colleagueResourceId });
    expect(resource?.member).toEqual({
      membershipId: colleagueMembershipId,
      displayName: 'Colleague',
    });
  });

  it('3. cannot link to another organization\'s Membership, at creation or by correction', async () => {
    await expect(
      createResource(owner.db, {
        organizationId,
        name: 'Cross-tenant at creation',
        membershipId: strangerMembershipId,
      }),
    ).rejects.toMatchObject({ code: 'resources.member_not_found' });

    const unlinked = await createResource(owner.db, { organizationId, name: 'Van 2' });
    await expect(
      setResourceMembership(owner.db, { resourceId: unlinked, membershipId: strangerMembershipId }),
    ).rejects.toMatchObject({ code: 'resources.member_not_found' });

    // Direct RPC, bypassing the domain layer entirely — the composite FK refuses it
    // regardless of caller, not just the function's own error mapping (D17's shape).
    const { error } = await owner.db.rpc('set_resource_membership', {
      p_resource_id: unlinked,
      p_membership_id: strangerMembershipId,
    });
    expect(error?.code).toBe('23503');
  });

  it('4. one Membership cannot represent two Resources', async () => {
    await expect(
      createResource(owner.db, {
        organizationId,
        name: 'Second Van For Colleague',
        membershipId: colleagueMembershipId,
      }),
    ).rejects.toMatchObject({ code: 'resources.member_already_linked' });

    const another = await createResource(owner.db, { organizationId, name: 'Van 3' });
    await expect(
      setResourceMembership(owner.db, { resourceId: another, membershipId: colleagueMembershipId }),
    ).rejects.toMatchObject({ code: 'resources.member_already_linked' });
  });

  it('5. two different Memberships may link to two different Resources', async () => {
    const ownerVan = await createResource(owner.db, {
      organizationId,
      name: 'Van 4',
      membershipId: ownerMembershipId,
    });
    const resource = await getResource(owner.db, { organizationId, resourceId: ownerVan });
    expect(resource?.member?.membershipId).toBe(ownerMembershipId);

    const colleagueResource = await getResource(owner.db, {
      organizationId,
      resourceId: colleagueResourceId,
    });
    expect(colleagueResource?.member?.membershipId).toBe(colleagueMembershipId);
    expect(resource?.member?.membershipId).not.toBe(colleagueResource?.member?.membershipId);
  });

  let sharedResourceId: string;

  it('6. an actor without resource.update cannot link or unlink, whoever created the Resource', async () => {
    sharedResourceId = await createResource(owner.db, { organizationId, name: 'Van 5' });

    await expect(
      setResourceMembership(restricted.db, {
        resourceId: sharedResourceId,
        membershipId: restrictedMembershipId,
      }),
    ).rejects.toMatchObject({ code: 'resources.update_forbidden' });

    // Direct RPC too — RLS is the boundary, not the domain layer's own check (I12).
    const { error } = await restricted.db.rpc('set_resource_membership', {
      p_resource_id: sharedResourceId,
      p_membership_id: restrictedMembershipId,
    });
    expect(error?.code).toBe('42501');

    // Non-vacuity: restricted still isn't blocked from everything, only this.
    const stillVisible = await getResource(owner.db, { organizationId, resourceId: sharedResourceId });
    expect(stillVisible?.member).toBeNull();
  });

  it('7. an authorized actor may change an existing link', async () => {
    await setResourceMembership(colleague.db, {
      resourceId: sharedResourceId,
      membershipId: restrictedMembershipId,
    });
    let resource = await getResource(owner.db, { organizationId, resourceId: sharedResourceId });
    expect(resource?.member?.membershipId).toBe(restrictedMembershipId);

    await setResourceMembership(colleague.db, {
      resourceId: sharedResourceId,
      membershipId: extraMembershipId,
    });
    resource = await getResource(owner.db, { organizationId, resourceId: sharedResourceId });
    expect(resource?.member?.membershipId).toBe(extraMembershipId);
  });

  it('8. an authorized actor may clear a link', async () => {
    await setResourceMembership(colleague.db, { resourceId: sharedResourceId, membershipId: null });
    const resource = await getResource(owner.db, { organizationId, resourceId: sharedResourceId });
    expect(resource?.member).toBeNull();
  });

  it('9. clearing the link does not delete the Resource', async () => {
    const resource = await getResource(owner.db, { organizationId, resourceId: sharedResourceId });
    expect(resource).not.toBeNull();
    expect(resource?.id).toBe(sharedResourceId);
    expect(resource?.name).toBe('Van 5');
  });

  it('10. existing Work Items against a Resource remain intact when its link changes', async () => {
    const crewVanId = await createResource(owner.db, { organizationId, name: 'Crew Van' });

    const typeId = await createWorkItemType(owner.db, { schedulable: true, organizationId, name: 'Callout' });
    const statusId = await createWorkItemStatus(owner.db, { organizationId, typeId, name: 'Open' });
    const workItemId = await createWorkItem(owner.db, {
      organizationId,
      title: 'Slice 0B regression callout',
      statusId,
    });
    await scheduleWorkItem(owner.db, {
      workItemId,
      resourceId: crewVanId,
      startsAt: '2026-11-02T09:00:00.000Z',
      endsAt: '2026-11-02T10:00:00.000Z',
    });

    // Re-link and clear the Resource's own identity link — the Work Item references the
    // Resource by id, not by Membership, so neither write should touch it.
    await setResourceMembership(owner.db, { resourceId: crewVanId, membershipId: restrictedMembershipId });
    await setResourceMembership(owner.db, { resourceId: crewVanId, membershipId: null });

    const workItems = await listWorkItems(owner.db, { organizationId, resourceId: crewVanId });
    expect(workItems.some((item) => item.id === workItemId)).toBe(true);
  });

  it('11. removing a Membership clears only the Resource\'s identity link, never organization_id, and never deletes the Resource', async () => {
    const deletionResourceId = await createResource(owner.db, {
      organizationId,
      name: 'Deletion Test Resource',
      membershipId: restrictedMembershipId,
    });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      // No membership-removal path exists anywhere in the application (Slice 0A's own
      // finding) — this is a direct connection deleting the row, exactly the kind of write
      // the FK's delete semantics must already be correct for before any caller can reach it.
      await pg.query('delete from public.memberships where id = $1', [restrictedMembershipId]);
    } finally {
      await pg.end();
    }

    const resource = await getResource(owner.db, { organizationId, resourceId: deletionResourceId });
    expect(resource).not.toBeNull();
    expect(resource?.id).toBe(deletionResourceId);
    expect(resource?.member).toBeNull();

    const { data: raw, error } = await owner.db
      .from('resources')
      .select('organization_id')
      .eq('id', deletionResourceId)
      .single();
    expect(error).toBeNull();
    expect(raw?.organization_id).toBe(organizationId);
  });

  it('12/13. resolves the current caller\'s Resource through Membership alone, never through a name', async () => {
    // Colleague's Resource is named "Van 9" — nothing about that name, "Colleague"'s display
    // name, a role or a custom field could resolve this; only membership_id can.
    const resolved = await getResourceForCurrentMember(colleague.db, { organizationId });
    expect(resolved?.id).toBe(colleagueResourceId);
    expect(resolved?.name).toBe('Van 9');

    // Extra's own membership represents nothing right now (cleared in test 8) — a caller with
    // no linked Resource gets null, not a guess.
    const none = await getResourceForCurrentMember(extra.db, { organizationId });
    expect(none).toBeNull();
  });

  it('14. organization isolation still holds for both Resources and Memberships', async () => {
    const acrossTheWall = await listResources(stranger.db, { organizationId });
    expect(acrossTheWall).toEqual([]);

    await expect(
      getResourceForCurrentMember(stranger.db, { organizationId }),
    ).resolves.toBeNull();
  });

  it('15. Schedule reads remain organization-wide — this slice narrows nothing there', async () => {
    // `viewer` holds no capability at all and represents no Resource, yet still sees every
    // resource in the schedule — visibility is unchanged by this slice (Slice 0A's own
    // finding, still true). Not `restricted`: test 11 deleted that membership outright, and a
    // caller removed from the organization correctly seeing nothing is I1, not a regression.
    const schedule = await listSchedule(viewer.db, {
      organizationId,
      within: { startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-03T00:00:00.000Z' },
    });
    const names = schedule.map((entry) => entry.resource.name);
    expect(names).toContain('Van 9');
    expect(names).toContain('Crew Van');
    expect(names.length).toBeGreaterThanOrEqual(6);
  });
});
