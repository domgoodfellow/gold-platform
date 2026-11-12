import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { inviteMember, listPendingInvitations, reissueInvitation, revokeInvitation } from '@/lib/domain/tenancy/invitations';
import { addMember } from '@/lib/domain/tenancy/members';
import { assignRole, createRole, listRoles, updateRoleCapabilities } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Nobody gives a permission they do not hold. The database enforces it wherever a permission can
 * reach a person: a role gaining permissions, a person put on a role, an invitation naming one.
 * Each refusal is asserted through the domain and through the direct write a caller could make.
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
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.user.id, email };
}

let owner: Actor;
let manager: Actor;
let organizationId: string;
let adminRoleId: string;
let managerRoleId: string;
let managerMembershipId: string;

const GRANT = { code: 'roles.grant_beyond_own' };

describe('nobody grants a permission they do not hold', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    owner = await signUp('grant-owner');
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: `Granting ${randomUUID().slice(0, 6)}`, displayName: 'Founder', currency: 'EUR' });
    adminRoleId = (await listRoles(owner.db, { organizationId })).find((r) => r.name === 'Admin')!.id;

    // A people manager: may manage roles and add contacts, and nothing else.
    managerRoleId = await createRole(owner.db, { organizationId, name: 'People manager', capabilities: ['role.manage', 'customer.create'] });
    manager = await signUp('grant-manager');
    managerMembershipId = await addMember(owner.db, { organizationId, email: manager.email, displayName: 'Manager', roleId: managerRoleId });
  });

  it('lets a manager create and extend a role within what they hold', async () => {
    const role = await createRole(manager.db, { organizationId, name: 'Intake', capabilities: [] });
    await updateRoleCapabilities(manager.db, { roleId: role, name: 'Intake', capabilities: ['customer.create'] });
    expect((await listRoles(owner.db, { organizationId })).find((r) => r.id === role)!.capabilities).toEqual(['customer.create']);
  });

  it('refuses a new role holding a permission the manager lacks, through the domain and a direct insert', async () => {
    await expect(createRole(manager.db, { organizationId, name: 'Too much', capabilities: ['billing.manage'] })).rejects.toMatchObject(GRANT);
    const direct = await manager.db.from('roles').insert({ organization_id: organizationId, name: 'Too much direct', capabilities: ['billing.manage'], created_by: manager.userId });
    expect(direct.error?.code).toBe('42501');
    expect((await listRoles(owner.db, { organizationId })).some((r) => r.name.startsWith('Too much'))).toBe(false);
  });

  it('refuses adding a permission the manager lacks to a role, their own included, but lets them remove one', async () => {
    await expect(updateRoleCapabilities(manager.db, { roleId: managerRoleId, name: 'People manager', capabilities: ['role.manage', 'customer.create', 'billing.manage'] })).rejects.toMatchObject(GRANT);
    const direct = await manager.db.from('roles').update({ capabilities: ['role.manage', 'customer.create', 'secret.manage'] }).eq('id', managerRoleId);
    expect(direct.error?.code).toBe('42501');

    // A role that already holds more than the manager does can still be renamed and reduced by them.
    const wide = await createRole(owner.db, { organizationId, name: 'Wide', capabilities: ['customer.create', 'invoice.issue'] });
    await updateRoleCapabilities(manager.db, { roleId: wide, name: 'Wide renamed', capabilities: ['customer.create', 'invoice.issue'] });
    await updateRoleCapabilities(manager.db, { roleId: wide, name: 'Wide renamed', capabilities: ['customer.create'] });
    await expect(updateRoleCapabilities(manager.db, { roleId: wide, name: 'Wide renamed', capabilities: ['customer.create', 'invoice.issue'] })).rejects.toMatchObject(GRANT);
  });

  it('refuses moving anyone, themselves included, onto a role that holds more than the manager does', async () => {
    await expect(assignRole(manager.db, { membershipId: managerMembershipId, roleId: adminRoleId })).rejects.toMatchObject(GRANT);
    const direct = await manager.db.from('memberships').update({ role_id: adminRoleId }).eq('id', managerMembershipId);
    expect(direct.error?.code).toBe('42501');
    const { data } = await owner.db.from('memberships').select('role_id').eq('id', managerMembershipId).single();
    expect(data?.role_id).toBe(managerRoleId);
  });

  it('refuses adding or inviting somebody onto such a role, and allows a role within reach', async () => {
    const newcomer = await signUp('grant-newcomer');
    await expect(addMember(manager.db, { organizationId, email: newcomer.email, displayName: 'Newcomer', roleId: adminRoleId })).rejects.toMatchObject(GRANT);
    await expect(inviteMember(manager.db, { organizationId, email: `invitee-${randomUUID().slice(0, 8)}@example.test`, roleId: adminRoleId })).rejects.toMatchObject(GRANT);

    const narrow = await createRole(manager.db, { organizationId, name: 'Narrow', capabilities: ['customer.create'] });
    await addMember(manager.db, { organizationId, email: newcomer.email, displayName: 'Newcomer', roleId: narrow });
    await inviteMember(manager.db, { organizationId, email: `invitee-${randomUUID().slice(0, 8)}@example.test`, roleId: narrow });
  });

  it('does not bind the owner, who holds every permission', async () => {
    const full = await createRole(owner.db, { organizationId, name: 'Finance lead', capabilities: ['billing.manage', 'invoice.issue', 'payment.record'] });
    await assignRole(owner.db, { membershipId: managerMembershipId, roleId: full });
    await assignRole(owner.db, { membershipId: managerMembershipId, roleId: managerRoleId });
  });

  it('refuses renewing an invitation beyond the manager’s permissions without rotating its token, but permits revocation', async () => {
    const email = `renewal-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(owner.db, { organizationId, email, roleId: adminRoleId });
    const invitation = (await listPendingInvitations(owner.db, { organizationId })).find((row) => row.email === email)!;
    const before = await owner.db.from('organization_invitations').select('expires_at').eq('id', invitation.id).single();
    await expect(reissueInvitation(manager.db, { id: invitation.id })).rejects.toMatchObject(GRANT);
    const direct = await manager.db.rpc('reissue_invitation', { p_id: invitation.id });
    expect(direct.error).toMatchObject({ code: '42501', details: 'grant_beyond_own' });
    const after = await owner.db.from('organization_invitations').select('expires_at').eq('id', invitation.id).single();
    expect(after.data).toEqual(before.data);
    await revokeInvitation(manager.db, { id: invitation.id });
    expect((await listPendingInvitations(owner.db, { organizationId })).some((row) => row.id === invitation.id)).toBe(false);

    const allowedEmail = `renewal-allowed-${randomUUID().slice(0, 8)}@example.test`;
    await inviteMember(manager.db, { organizationId, email: allowedEmail, roleId: managerRoleId });
    const allowed = (await listPendingInvitations(manager.db, { organizationId })).find((row) => row.email === allowedEmail)!;
    expect(await reissueInvitation(manager.db, { id: allowed.id })).toEqual(expect.any(String));
  });
});
