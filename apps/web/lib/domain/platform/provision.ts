import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import {
  FOUNDING_ROLE,
  normaliseCurrency,
  normaliseName,
} from '@/lib/domain/tenancy/organizations';

/**
 * The operator door: GOLD creates a business and hands it to its owner (D29). Not an
 * alternative to `createOrganization` — both doors normalise through the same three imported
 * rules, so a provisioned business is the same row under the same policies as a self-founded
 * one. What differs is only that the founding member is somebody other than the caller, which
 * `create_organization`'s `auth.uid()` gate can't express — hence a second function rather than
 * a flag on the first. No `requireStaff()` here: the gate is `provision_organization`'s own
 * Postgres-role check (I12).
 */
export async function provisionOrganization(
  db: Db,
  input: {
    /** Who the business belongs to. They must already have an account. */
    ownerEmail: string;
    name: string;
    /** What the business will call its owner — per-tenant, never a global profile (D19). */
    displayName?: string;
    timezone?: string;
    currency: string;
  },
): Promise<string> {
  await requireActor(db);

  const name = normaliseName(input.name);
  const currency = normaliseCurrency(input.currency);

  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  if (ownerEmail.length === 0) {
    throw new DomainError(
      'Say who the business belongs to.',
      'platform.owner_email_required',
    );
  }

  // Deliberately shallow — checks the shape of an address; the database is the real check when
  // it looks up the account.
  if (!ownerEmail.includes('@')) {
    throw new DomainError('That is not an email address.', 'platform.owner_email_invalid');
  }

  const displayName = (input.displayName ?? '').trim();

  const { data, error } = await db.rpc('provision_organization', {
    p_owner_email: ownerEmail,
    p_name: name,
    // Same founding role and capabilities through either door — a narrower one here would be
    // GOLD deciding what a business's owner may do.
    p_role: FOUNDING_ROLE,
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: displayName,
    // UTC rather than the staff member's own timezone — a Montreal business shouldn't land on a
    // London clock because of where the operator was sitting (I9).
    p_timezone: (input.timezone || 'UTC') as string,
    p_currency: currency,
  });

  if (error) {
    throw new DomainError(error.message, 'platform.provision_failed');
  }

  return data as string;
}
