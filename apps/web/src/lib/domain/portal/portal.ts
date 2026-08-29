import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The customer portal: a customer seeing their own work, and what they owe.
 *
 * **This is D22's second surface, and it pays for nothing.** The axis was decided and built by
 * booking; everything here keys on `app.current_external_tenant()` exactly as that does, and
 * the only thing the portal added to the model is the column D22 predicted it would —
 * `external_actors.customer_id`, written by one privileged function on presentation of a token
 * and by nothing else. That is what "whichever surface goes first pays for the model; the
 * other two inherit it" was a claim about, and it held.
 *
 * **How the two surfaces differ is worth stating precisely**, because it is the whole reason a
 * column was needed. Booking scopes an outsider to rows *they made* — they created their own
 * customer row, so `created_by` identifies it exactly. A customer of ten years made nothing:
 * the business did. So the portal scopes them to rows *about them*, and every external policy
 * now reads "rows I made, or rows about me".
 *
 * **What a link means, said plainly rather than implied.** Anyone holding the URL is that
 * customer. That is the security model of a link to a shared document, it is the business's to
 * revoke, and it is the honest cost of not having a channel to prove control of an address —
 * which is M5's, not this milestone's.
 */

export type PortalInvite = {
  id: string;
  customerId: string;
  createdAt: string;
  revokedAt: string | null;
};

/**
 * Make a link for one customer.
 *
 * Returns the token once. It is stored rather than hashed, and that is a decision rather than
 * an oversight: a business that has lost the link it sent must be able to send the same one
 * again, and a hash would only mean issuing a second. It is a shareable link, not a password,
 * and treating it as a password would protect nothing while making the product worse.
 *
 * No capability of its own. `customer.create` already means "this person handles customers",
 * and inviting one is not a different authority.
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

/**
 * Withdraw one.
 *
 * An update rather than a delete, because a business wants to see that a link existed and was
 * withdrawn — and because the column grant is `revoked_at` alone, nothing can move an
 * invitation to a different customer and hand its holder somebody else's history.
 */
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
 * Present a link and become that customer.
 *
 * Anonymous sign-in first, for the reason D22 gives: it produces a genuine `auth.uid()`, so
 * RLS stays the boundary and I11 needs no second shape. Then the token is exchanged for a
 * binding by a privileged function — the caller has no binding yet, so there is nothing for
 * RLS to key on, which is the same circle `resolveBookingSlug` breaks.
 *
 * Returns the organization the link belongs to. A browser already bound to a *different*
 * business is refused rather than moved: a binding is exactly one tenant, and that is
 * structural rather than polite.
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
