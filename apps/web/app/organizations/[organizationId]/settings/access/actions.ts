'use server';

import { revalidatePath } from 'next/cache';
import { InviteMemberSchema } from '@gold/schemas';
import { platformEmailSender } from '@/lib/adapters/email';
import { requireAccessToken } from '@/lib/api/client';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { addMember } from '@/lib/domain/tenancy/members';
import { inviteMember, listPendingInvitations, reissueInvitation, revokeInvitation } from '@/lib/domain/tenancy/invitations';
import { assignRole, createRole, updateRoleCapabilities } from '@/lib/domain/tenancy/roles';
import { requestOrigin } from '@/lib/route/origin';
import { requireOrganization } from '@/lib/route/organization';

export type CreateRoleState = { error: string | null; created: boolean };

export async function createRoleAction(
  _previous: CreateRoleState,
  formData: FormData,
): Promise<CreateRoleState> {
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
      return { error: error.message, created: false };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null, created: true };
}

export type UpdateRoleState = { error: string | null };

export async function updateRoleAction(
  _previous: UpdateRoleState,
  formData: FormData,
): Promise<UpdateRoleState> {
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
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null };
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

export type InviteMemberState = {
  error: string | null;
  link: string | null;
  /** `null` until a send was attempted; distinguishes "created and sent" from "created, copy this link" (work order 1 §10). */
  emailSent: boolean | null;
};

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
    return { error: parsed.error.issues[0]?.message ?? 'That invitation is not valid.', link: null, emailSent: null };
  }

  let token: string;
  let invitationId: string;
  try {
    token = await inviteMember(db, parsed.data);
    const pending = await listPendingInvitations(db, { organizationId });
    invitationId = pending.find((invitation) => invitation.email === parsed.data.email)?.id ?? '';
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message, link: null, emailSent: null };
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

  // Best-effort: an invite that could not be emailed is still a real invite. The link is always
  // shown regardless, exactly as `create_portal_invite`'s own token is shown so it can be resent.
  let emailSent = false;
  if (invitationId) {
    try {
      const sender = await platformEmailSender({ token: await requireAccessToken(db) });
      const receipt = await sender?.sendInvitationEmail({ organizationId, invitationId, link });
      emailSent = receipt?.sent ?? false;
    } catch {
      // Swallowed on purpose — the copyable link below is the fallback, not a second attempt.
    }
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null, link, emailSent };
}

export type ReissueInvitationState = { error: string | null; link: string | null; emailSent: boolean | null };

/**
 * Resend: a fresh token, a fresh link, a fresh send attempt — never the original plaintext, which
 * no longer exists anywhere to resend (D33). The old link stops working the instant this commits.
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
      return { error: error.message, link: null, emailSent: null };
    }
    throw error;
  }

  const link = `${await requestOrigin()}/organizations/accept-invite/${token}`;

  let emailSent = false;
  try {
    const sender = await platformEmailSender({ token: await requireAccessToken(db) });
    const receipt = await sender?.sendInvitationEmail({ organizationId, invitationId, link });
    emailSent = receipt?.sent ?? false;
  } catch {
    // Swallowed on purpose, the same reason inviteMemberAction's own send is.
  }

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null, link, emailSent };
}

export type AssignRoleState = { error: string | null };

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

  revalidatePath(`/organizations/${organizationId}/settings/access`);
  return { error: null };
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
