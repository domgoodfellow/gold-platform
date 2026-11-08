import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { claimProposalInvite } from './proposal-invites';

/**
 * Who a proposal request is, resolved once and by the database.
 *
 * Not an organization member and not a portal customer: the person a business sent one proposal
 * link to, for as long as that link is live and the exchange has not expired. Every proposal
 * operation reads this instead of being handed a token, an organization or a customer; the id of
 * the proposal version a person is answering is still received, because the function that
 * answers re-proves it belongs to this binding and pins the decision to that exact version.
 *
 * `null` is one answer for four situations — no session, never a recipient, link revoked,
 * exchange expired — because telling a holder of a withdrawn link which one it was would tell
 * them the link was once real.
 */
export type ProposalAccessContext = {
  organizationId: string;
  customerId: string;
  inviteId: string;
  expiresAt: string;
};

export async function proposalAccessContext(db: Db): Promise<ProposalAccessContext | null> {
  const { data, error } = await db.rpc('proposal_context');
  // No session at all reaches the database as `anon`, which holds no execute on the function: the
  // same answer as every other way of not being a recipient.
  if (error?.code === '42501') return null;
  if (error) throw fromDatabaseError(error, 'proposal_access.context_failed');
  const row = data?.[0];
  if (!row || !row.customer_id) return null;
  return {
    organizationId: row.organization_id,
    customerId: row.customer_id,
    inviteId: row.proposal_invite_id,
    expiresAt: row.expires_at,
  };
}

export async function requireProposalAccessContext(db: Db): Promise<ProposalAccessContext> {
  const context = await proposalAccessContext(db);
  if (!context) throw new DomainError('This session has ended. Open the link you were sent again.', 'proposal_access.no_session');
  return context;
}

/**
 * Exchange a link for a proposal session, **always on a fresh one** — the portal's reasoning:
 * a leftover cookie must never become the recipient this link names, and a refused link leaves no
 * session behind. Local sign-out only; it revokes nothing for anyone else.
 */
export async function exchangeProposalLink(db: Db, input: { token: string }): Promise<string> {
  await db.auth.signOut({ scope: 'local' });
  try {
    return await claimProposalInvite(db, input);
  } catch (error) {
    await db.auth.signOut({ scope: 'local' });
    throw error;
  }
}
