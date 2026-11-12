import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { addMember } from '@/lib/domain/tenancy/members';
import { inviteMember, listPendingInvitations, revokeInvitation } from '@/lib/domain/tenancy/invitations';
import { assignRole, createRole, deleteRole, listRoles } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Deleting a role. Only a role nobody holds and no open invitation names can go, and the database
 * decides that, not only `deleteRole`: the direct RPC is refused the same way.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Actor = { db: SupabaseClient; userId: string; email: string };

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
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.user.id, email };
}

let owner: Actor;
let helper: Actor;
let organizationId: string;
let adminRoleId: string;
let helperMembershipId: string;

describe('deleting a role', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    owner = await signUp('roledelete');
    organizationId = await foundBusiness({
      ownerEmail: owner.email,
      name: `Role Deleting ${randomUUID().slice(0, 6)}`,
      displayName: 'Founder',
      currency: 'EUR',
    });
    adminRoleId = (await listRoles(owner.db, { organizationId })).find((r) => r.name === 'Admin')!.id;

    const restricted = await createRole(owner.db, { organizationId, name: 'Restricted', capabilities: ['customer.create'] });
    helper = await signUp('roledelete-helper');
    helperMembershipId = await addMember(owner.db, { organizationId, email: helper.email, displayName: 'Helper', roleId: restricted });
  });

  it('deletes a role nobody holds and records it on the timeline', async () => {
    const unused = await createRole(owner.db, { organizationId, name: 'Unused', capabilities: ['customer.create'] });
    await deleteRole(owner.db, { roleId: unused });

    expect((await listRoles(owner.db, { organizationId })).some((r) => r.id === unused)).toBe(false);
    const { data } = await owner.db.from('events').select('action, payload').eq('entity_id', unused).eq('action', 'role.deleted');
    expect(data).toEqual([{ action: 'role.deleted', payload: { name: 'Unused' } }]);
  });

  it('refuses a role people still hold, through the domain and through the RPC directly', async () => {
    const restricted = (await listRoles(owner.db, { organizationId })).find((r) => r.name === 'Restricted')!.id;
    await expect(deleteRole(owner.db, { roleId: restricted })).rejects.toMatchObject({ code: 'roles.in_use' });
    const direct = await owner.db.rpc('delete_role', { p_role_id: restricted });
    expect(direct.error?.code).toBe('23503');
    await expect(deleteRole(owner.db, { roleId: adminRoleId })).rejects.toMatchObject({ code: 'roles.in_use' });
    expect((await listRoles(owner.db, { organizationId })).some((r) => r.id === restricted)).toBe(true);
  });

  it('deletes the role once its members are moved off it', async () => {
    const temporary = await createRole(owner.db, { organizationId, name: 'Temporary', capabilities: ['customer.create'] });
    const restricted = (await listRoles(owner.db, { organizationId })).find((r) => r.name === 'Restricted')!.id;
    await assignRole(owner.db, { membershipId: helperMembershipId, roleId: temporary });
    await expect(deleteRole(owner.db, { roleId: temporary })).rejects.toMatchObject({ code: 'roles.in_use' });
    await assignRole(owner.db, { membershipId: helperMembershipId, roleId: restricted });
    await deleteRole(owner.db, { roleId: temporary });
    expect((await listRoles(owner.db, { organizationId })).some((r) => r.id === temporary)).toBe(false);
  });

  it('refuses a role an open invitation names, and deletes it once the invitation is revoked', async () => {
    const invited = await createRole(owner.db, { organizationId, name: 'Invited', capabilities: ['customer.create'] });
    const email = `invitee-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(owner.db, { organizationId, email, roleId: invited });
    await expect(deleteRole(owner.db, { roleId: invited })).rejects.toMatchObject({ code: 'roles.invited' });

    const pending = await listPendingInvitations(owner.db, { organizationId });
    await revokeInvitation(owner.db, { id: pending.find((invitation) => invitation.email === email)!.id });
    await deleteRole(owner.db, { roleId: invited });
    expect((await listRoles(owner.db, { organizationId })).some((r) => r.id === invited)).toBe(false);
  });

  it('refuses someone without role.manage (42501), through the domain and the RPC', async () => {
    const spare = await createRole(owner.db, { organizationId, name: 'Spare', capabilities: [] });
    await expect(deleteRole(helper.db, { roleId: spare })).rejects.toMatchObject({ code: 'roles.forbidden' });
    expect((await helper.db.rpc('delete_role', { p_role_id: spare })).error?.code).toBe('42501');
    expect((await listRoles(owner.db, { organizationId })).some((r) => r.id === spare)).toBe(true);
  });

  it('refuses a role in another business the same way as one that does not exist', async () => {
    const stranger = await signUp('roledelete-stranger');
    await foundBusiness({ ownerEmail: stranger.email, name: `Elsewhere ${randomUUID().slice(0, 6)}`, displayName: 'Stranger', currency: 'EUR' });
    const spare = await createRole(owner.db, { organizationId, name: 'Kept', capabilities: [] });
    await expect(deleteRole(stranger.db, { roleId: spare })).rejects.toMatchObject({ code: 'roles.forbidden' });
    await expect(deleteRole(stranger.db, { roleId: randomUUID() })).rejects.toMatchObject({ code: 'roles.forbidden' });
    expect((await listRoles(owner.db, { organizationId })).some((r) => r.id === spare)).toBe(true);
  });
});
