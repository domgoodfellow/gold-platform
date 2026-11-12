'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { InviteMemberSchema } from '@gold/schemas';
import { platformEmailSender } from '@/lib/adapters/email';
import { requireAccessToken } from '@/lib/api/client';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { addMember } from '@/lib/domain/tenancy/members';
import { inviteMember, listPendingInvitations, reissueInvitation, revokeInvitation } from '@/lib/domain/tenancy/invitations';
import { assignRole, createRole, deleteRole, updateRoleCapabilities } from '@/lib/domain/tenancy/roles';
import { requestOrigin } from '@/lib/route/origin';
import { requireOrganization } from '@/lib/route/organization';

/** `savedAt` changes on every successful save, so the editor can confirm each one. */
export type SaveRoleState = { error: string | null; savedAt: number | null; created?: boolean };

/** Creates the role; the editor confirms success and returns to the list. */
export async function createRoleAction(
  _previous: SaveRoleState,
  formData: FormData,
): Promise<SaveRoleState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await createRole(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      // getAll, because capabilities are checkboxes and an unchecked box sends nothing.
      capabilities: formData.getAll('capabilities').map(String),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, savedAt: null };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`, 'layout');
  return { error: null, savedAt: Date.now(), created: true };
}

export async function updateRoleAction(
  _previous: SaveRoleState,
  formData: FormData,
): Promise<SaveRoleState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await updateRoleCapabilities(db, {
      roleId: String(formData.get('roleId') ?? ''),
      name: String(formData.get('name') ?? ''),
      capabilities: formData.getAll('capabilities').map(String),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, savedAt: null };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`, 'layout');
  return { error: null, savedAt: Date.now() };
}

export type DeleteRoleState = { error: string | null };

/** Deletes an unused role and returns to the list. `delete_role` refuses one still in use. */
export async function deleteRoleAction(
  _previous: DeleteRoleState,
  formData: FormData,
): Promise<DeleteRoleState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await deleteRole(db, { roleId: String(formData.get('roleId') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access/roles`);
  revalidatePath(`/organizations/${organizationId}/settings/access/history`);
  redirect(`/organizations/${organizationId}/settings/access/roles?deleted=1`);
}

export type AddMemberState = { error: string | null; created: boolean };

export async function addMemberAction(
  _previous: AddMemberState,
  formData: FormData,
): Promise<AddMemberState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    // Neither the organization id nor the role id is re-checked here. `add_member_by_email`
    // asserts role.manage itself — it is SECURITY DEFINER, so RLS is not doing it — and the
    // composite foreign key refuses a role belonging to another organization.
    await addMember(db, {
      organizationId,
      email: String(formData.get('email') ?? ''),
      displayName: String(formData.get('displayName') ?? ''),
      roleId: String(formData.get('roleId') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, created: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null, created: true };
}

/**
 * What happened to the invitation email, as far as GildOps can know at this moment. `accepted`
 * means GildOps' mail service took it for delivery, never that it arrived: arrival is reported
 * later, under Pending invitations. When it was not accepted, `reason` says why in plain words.
 */
export type InvitationEmailOutcome = { accepted: boolean; reason: string | null };

export type InviteMemberState = {
  error: string | null;
  link: string | null;
  /** `null` until a send was attempted; distinguishes "created and emailed" from "created, not emailed" (work order 1 §10). */
  email: InvitationEmailOutcome | null;
};

/**
 * One attempt to email an invitation from GildOps' own platform sender — never the business's
 * own sending address, which a team invitation does not need. Every way it can fail comes back as
 * a reason the manager is shown, rather than being swallowed into a bare link.
 */
async function emailInvitation(db: Awaited<ReturnType<typeof getDb>>, input: { organizationId: string; invitationId: string; link: string }): Promise<InvitationEmailOutcome> {
  if (!input.invitationId) return { accepted: false, reason: 'The invitation was created, but GildOps could not find it again to email it.' };
  const sender = await platformEmailSender({ token: await requireAccessToken(db) });
  if (!sender) return { accepted: false, reason: 'Sending invitation emails isn’t available yet. Share the invitation link instead.' };
  try {
    const receipt = await sender.sendInvitationEmail(input);
    return receipt.sent ? { accepted: true, reason: null } : { accepted: false, reason: receipt.detail ?? 'GildOps’ mail service did not accept the invitation.' };
  } catch (error) {
    if (error instanceof DomainError) {
      return { accepted: false, reason: error.code === 'api.unreachable' ? 'GildOps’ mail service could not be reached.' : 'GildOps’ mail service could not take the invitation right now.' };
    }
    throw error;
  }
}

export async function inviteMemberAction(
  _previous: InviteMemberState,
  formData: FormData,
): Promise<InviteMemberState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  const parsed = InviteMemberSchema.safeParse({
    organizationId,
    email: formData.get('email'),
    roleId: formData.get('roleId'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'That invitation is not valid.', link: null, email: null };
  }

  let token: string;
  let invitationId: string;
  try {
    token = await inviteMember(db, parsed.data);
    const pending = await listPendingInvitations(db, { organizationId });
    invitationId = pending.find((invitation) => invitation.email === parsed.data.email)?.id ?? '';
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, link: null, email: null };
    }
    throw error;
  }

  // The same helper `forgot-password`, `sign-up` and OAuth already build a link against —
  // one place this repository reads a request's own origin, not a fourth reimplementation of
  // it. Still the request's own `Host`/`X-Forwarded-Proto` today, not a hostname this platform
  // has resolved and allowlisted itself — that trust model arrives with actual hostname routing
  // (`infrastructure/deployment/domains/README.md`), and this link construction moves onto it
  // then rather than guessing at it now.
  const link = `${await requestOrigin()}/organizations/accept-invite/${token}`;

  // An invite that could not be emailed is still a real invite. The link is returned so a manager
  // may choose to share it themselves; it is never presented as having been emailed.
  const email = await emailInvitation(db, { organizationId, invitationId, link });

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null, link, email };
}

export type ReissueInvitationState = { error: string | null; link: string | null; email: InvitationEmailOutcome | null };

/**
 * Resend: a fresh token, a fresh link, a fresh send attempt — never the original plaintext, which
 * no longer exists anywhere to resend. The old link stops working the instant this commits.
 */
export async function reissueInvitationAction(
  _previous: ReissueInvitationState,
  formData: FormData,
): Promise<ReissueInvitationState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const invitationId = String(formData.get('id') ?? '');
  await requireOrganization(organizationId);

  let token: string;
  try {
    token = await reissueInvitation(db, { id: invitationId });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, link: null, email: null };
    }
    throw error;
  }

  const link = `${await requestOrigin()}/organizations/accept-invite/${token}`;
  const email = await emailInvitation(db, { organizationId, invitationId, link });

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null, link, email };
}

export type AssignRoleState = { error: string | null; savedAt?: number };

/**
 * Point an existing membership at a different role.
 *
 * The last-manager invariant, whether the role belongs to this organization, and whether the
 * caller may do this at all are all decided inside `assign_role`/`memberships_update` — this
 * action contributes nothing but forwarding the two ids and turning a `DomainError` into
 * something the row can display next to itself.
 */
export async function assignRoleAction(
  _previous: AssignRoleState,
  formData: FormData,
): Promise<AssignRoleState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await assignRole(db, {
      membershipId: String(formData.get('membershipId') ?? ''),
      roleId: String(formData.get('roleId') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`, 'layout');
  return { error: null, savedAt: Date.now() };
}

export type RevokeInvitationState = { error: string | null };

export async function revokeInvitationAction(
  _previous: RevokeInvitationState,
  formData: FormData,
): Promise<RevokeInvitationState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await revokeInvitation(db, { id: String(formData.get('id') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null };
}
