import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * Inviting somebody who may not have an account yet — the gap `add_member_by_email` left open,
 * closed by `invite_member`/`accept_invitation` (20260915000003). Modeled on
 * `lib/domain/portal/portal.ts`, with one difference that matters: a portal invite is a
 * shareable view-only link and stores its token in plaintext; this grants a role, so only a hash
 * is ever stored, and the plaintext is returned once, here, to build a link or an email.
 */

export type PendingInvitation = {
  id: string;
  email: string;
  roleId: string;
  roleName: string;
  createdAt: string;
  expiresAt: string;
};

/** Generates and stores an invitation, returning the one-time plaintext token. */
export async function inviteMember(
  db: Db,
  input: { organizationId: string; email: string; roleId: string },
): Promise<string> {
  await requireActor(db);

  const { data, error } = await db.rpc('invite_member', {
    p_organization_id: input.organizationId,
    p_email: input.email,
    p_role_id: input.roleId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot invite people here.', 'invitations.forbidden');
    }
    if (error.code === '23505') {
      throw new DomainError(
        'There is already a pending invitation to that address.',
        'invitations.already_pending',
      );
    }
    if (error.code === '22023') {
      throw new DomainError('That is not an email address.', 'invitations.email_invalid');
    }
    if (error.code === 'GD004') {
      throw new DomainError(
        'That person is already a member of this organization.',
        'invitations.already_member',
      );
    }
    throw new DomainError(error.message, 'invitations.invite_failed');
  }

  return data as string;
}

/**
 * Invitations still open — accepted and revoked ones are history, not shown here, and neither
 * is one that has quietly expired: `accepted_at`/`revoked_at` being null only means nobody has
 * *acted* on it, not that it could still be accepted. A business re-inviting the same address
 * closes an expired row automatically (`invite_member`); until that happens, this list must not
 * keep calling it "pending" itself.
 */
export async function listPendingInvitations(
  db: Db,
  input: { organizationId: string },
): Promise<PendingInvitation[]> {
  const { data, error } = await db
    .from('organization_invitations')
    .select('id, email, created_at, expires_at, role:roles!inner(id, name)')
    .eq('organization_id', input.organizationId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'invitations.list_failed');
  }

  return (data ?? []).map((row) => {
    const role = Array.isArray(row.role) ? row.role[0] : row.role;
    return {
      id: row.id,
      email: row.email,
      roleId: role?.id ?? '',
      roleName: role?.name ?? '',
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  });
}

/**
 * An update, not a delete — the same reason `revokePortalInvite` keeps its row. Goes through
 * `revoke_invitation` rather than a column update: `revoked_at` carries no update grant to
 * `authenticated` at all (20260915000005), so this is the only door, and it is the only path
 * that can move the column at all — never back to null, never on an already-accepted row.
 */
export async function revokeInvitation(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('revoke_invitation', { p_id: input.id });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot revoke that invitation.', 'invitations.revoke_forbidden');
    }
    throw new DomainError(error.message, 'invitations.revoke_failed');
  }
}

/**
 * Claims an invitation. Unlike the portal's `claimPortalInvite`, this never signs anyone in
 * anonymously — accepting a role requires being the genuine account the invitation named, so the
 * caller must already be signed in (or have just signed up) as themselves before this is called.
 */
export async function acceptInvitation(
  db: Db,
  input: { token: string; displayName: string },
): Promise<string> {
  const { data, error } = await db.rpc('accept_invitation', {
    p_token: input.token,
    p_display_name: input.displayName,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'That invitation is not valid, or was sent to a different address.',
        'invitations.invalid',
      );
    }
    if (error.code === 'GD004') {
      throw new DomainError(
        'You are already a member of this organization.',
        'invitations.already_member',
      );
    }
    throw new DomainError(error.message, 'invitations.accept_failed');
  }

  return data as string;
}
