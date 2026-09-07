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
    .select('id, customer_id, created_at, revoked_at')
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'portal.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    customerId: row.customer_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  }));
}

/** An update, not a delete — a business wants to see that a link existed and was withdrawn. */
export async function revokePortalInvite(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db
    .from('customer_portal_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', input.id);

  if (error) {
    throw new DomainError(error.message, 'portal.revoke_failed');
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
