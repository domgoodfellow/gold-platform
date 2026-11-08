import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * Who a portal request is, resolved once and by the database.
 *
 * Not an organization member: there is no role here, no capability and no membership. It is the
 * customer a business sent a link to, for as long as that link is live and the exchange has not
 * expired. Every portal operation reads this instead of being handed an organization, a customer
 * or the link's token; an id of a record is still fine to receive, because the policy that
 * answers for it already reads the same binding.
 *
 * `null` is one answer for four situations — no session, never a portal customer, link revoked,
 * exchange expired — because telling a holder of a withdrawn link which one it was would tell them
 * the link was once real.
 */
export type PortalContext = {
  organizationId: string;
  customerId: string;
  inviteId: string;
  expiresAt: string;
};

export async function portalContext(db: Db): Promise<PortalContext | null> {
  const { data, error } = await db.rpc('portal_context');
  // No session at all reaches the database as `anon`, which holds no execute on the function: the
  // same answer as every other way of not being a portal customer.
  if (error?.code === '42501') return null;
  if (error) throw fromDatabaseError(error, 'portal.context_failed');
  const row = data?.[0];
  if (!row || !row.customer_id) return null;
  return {
    organizationId: row.organization_id,
    customerId: row.customer_id,
    inviteId: row.portal_invite_id,
    expiresAt: row.expires_at,
  };
}

export async function requirePortalContext(db: Db): Promise<PortalContext> {
  const context = await portalContext(db);
  if (!context) throw new DomainError('This session has ended. Open the link the business sent you again.', 'portal.no_session');
  return context;
}
