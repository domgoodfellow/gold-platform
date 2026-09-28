import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The customer portal: a customer seeing their own work and what they owe (D22's second
 * surface). Booking scopes an outsider to rows *they made* (`created_by`); a returning customer
 * made nothing themselves, so the portal scopes to rows *about them* via
 * `external_actors.customer_id`, written by one privileged function on presentation of a token.
 */

export type PortalInvite = {
  id: string;
  customerId: string;
  /**
   * The shareable link's own credential — recoverable on purpose. `create_portal_invite`'s own
   * comment says why: a business that has lost the link it sent must be able to read it again
   * and send the same one, because this is a shared-document link, not a password. Nothing about
   * a revoked invite's token still working — `claim_portal_invite` filters `revoked_at is null`
   * — so there is no reason to withhold it here either.
   */
  token: string;
  createdAt: string;
  revokedAt: string | null;
};

/**
 * Make a link for one customer. The token is stored, not hashed — a business that's lost the
 * link it sent must be able to resend the same one; it's a shareable link, not a password.
 * No capability of its own — `customer.create` already covers it.
 */
export async function createPortalInvite(
  db: Db,
  input: { customerId: string },
): Promise<string> {
  await requireActor(db);

  const { data, error } = await db.rpc('create_portal_invite', {
    p_customer_id: input.customerId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot invite customers here.', 'portal.forbidden');
    }
    throw new DomainError(error.message, 'portal.invite_failed');
  }

  return data as string;
}

/** Every link this business has made for one customer, withdrawn ones included. */
export async function listPortalInvites(
  db: Db,
  input: { organizationId: string; customerId: string },
): Promise<PortalInvite[]> {
  const { data, error } = await db
    .from('customer_portal_invites')
    .select('id, customer_id, token, created_at, revoked_at')
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'portal.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    token: row.token,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

/** Whether this business has invited any customer to the portal at all, and how many links are still live — the one business-wide fact the per-customer invite model supports. */
export async function organizationPortalInviteCount(
  db: Db,
  input: { organizationId: string },
): Promise<{ total: number; active: number }> {
  const { count: total, error: totalError } = await db
    .from('customer_portal_invites')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId);
  if (totalError) throw new DomainError(totalError.message, 'portal.list_failed');

  const { count: active, error: activeError } = await db
    .from('customer_portal_invites')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId)
    .is('revoked_at', null);
  if (activeError) throw new DomainError(activeError.message, 'portal.list_failed');

  return { total: total ?? 0, active: active ?? 0 };
}

/**
 * An update, not a delete — a business wants to see that a link existed and was withdrawn.
 *
 * Checks `returning` rather than trusting an error-free response, the same shape
 * `change_work_item_status` already uses: `customer_portal_invites_update` requires
 * `customer.create`, and a caller without it does not raise here — the policy simply matches
 * no row. Without this check that would look identical to success.
 */
export async function revokePortalInvite(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { data, error } = await db
    .from('customer_portal_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', input.id)
    .select('id');

  if (error) {
    throw new DomainError(error.message, 'portal.revoke_failed');
  }
  if (!data || data.length === 0) {
    throw new DomainError('No such link, or you may not revoke it.', 'portal.revoke_forbidden');
  }
}

/**
 * Present a link and become that customer. Anonymous sign-in first (D22) produces a genuine
 * `auth.uid()` so RLS stays the boundary; the token is then exchanged for a binding by a
 * privileged function, since the caller has no binding yet for RLS to key on. A browser already
 * bound to a different business is refused rather than moved — a binding is exactly one tenant.
 */
export async function claimPortalInvite(db: Db, input: { token: string }): Promise<string> {
  const { data: existing } = await db.auth.getUser();

  if (!existing.user) {
    const { error } = await db.auth.signInAnonymously();
    if (error) {
      throw new DomainError('This link cannot be opened right now.', 'portal.no_session');
    }
  }

  const { data, error } = await db.rpc('claim_portal_invite', { p_token: input.token });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'That link is not valid. Ask the business for a new one.',
        'portal.invalid_link',
      );
    }
    throw new DomainError(error.message, 'portal.claim_failed');
  }

  return data as string;
}
