import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The link a salesperson sends a prospect to review their own commercial proposal — a third kind
 * of token over the anonymous-session model's external axis, the same shared-document model `customer_portal_invites`
 * already uses. See `20261022000003_a_prospect_reviews_their_own_proposal.sql`.
 */
export type ProposalInvite = {
  id: string;
  customerId: string;
  token: string;
  createdAt: string;
  revokedAt: string | null;
};

/** Make a link for one customer. Requires price.manage — sending a commercial proposal is a pricing act. */
export async function createProposalInvite(db: Db, input: { customerId: string }): Promise<string> {
  await requireActor(db);

  const { data, error } = await db.rpc('create_proposal_invite', { p_customer_id: input.customerId });
  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot send proposals to customers here.', 'proposal_invites.forbidden');
    }
    throw new DomainError(error.message, 'proposal_invites.create_failed');
  }
  return data as string;
}

/** Every link built for one customer, withdrawn ones included. */
export async function listProposalInvites(
  db: Db,
  input: { organizationId: string; customerId: string },
): Promise<ProposalInvite[]> {
  const { data, error } = await db
    .from('customer_proposal_invites')
    .select('id, customer_id, token, created_at, revoked_at')
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false });
  if (error) throw new DomainError(error.message, 'proposal_invites.list_failed');

  return (data ?? []).map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    token: row.token,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

export async function revokeProposalInvite(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { data, error } = await db
    .from('customer_proposal_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', input.id)
    .select('id');
  if (error) throw new DomainError(error.message, 'proposal_invites.revoke_failed');
  if (!data || data.length === 0) {
    throw new DomainError('No such link, or you may not revoke it.', 'proposal_invites.revoke_forbidden');
  }
}

/**
 * Present a link and become that customer, exactly as `claimPortalInvite` does for the portal —
 * one shared axis, a second kind of invite over it. Anonymous sign-in first, kept alive:
 * this session needs to come back and read what it just unlocked, unlike public intake's own
 * sign-out-immediately shape.
 */
export async function claimProposalInvite(db: Db, input: { token: string }): Promise<string> {
  const { data: existing } = await db.auth.getUser();

  if (!existing.user) {
    const { error } = await db.auth.signInAnonymously();
    if (error) {
      throw new DomainError('This link cannot be opened right now.', 'proposal_invites.no_session');
    }
  }

  const { data, error } = await db.rpc('claim_proposal_invite', { p_token: input.token });
  if (error) {
    if (error.code === '42501') {
      throw new DomainError('That link is not valid. Ask GildOps for a new one.', 'proposal_invites.invalid_link');
    }
    throw new DomainError(error.message, 'proposal_invites.claim_failed');
  }
  return data as string;
}
