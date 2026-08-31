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
 * The operator door: GOLD creates a business and hands it to its owner (D29).
 *
 * **This is not an alternative to `createOrganization` and must never become one.** D29's
 * correction is that provisioned and self-served are two doors onto one creation path — what
 * separates them is who does the configuring, not what kind of tenant comes out. A business
 * provisioned here is the same row under the same policies as one founded by its own owner, and
 * the way that stays true is that both doors normalise through the same three rules imported
 * above rather than each having their own.
 *
 * What differs, and all that differs: **the founding member is somebody other than the
 * caller.** That is the one thing `create_organization` cannot express, because its whole gate
 * is `auth.uid()` and it makes the caller the founder. Hence a second database function rather
 * than a flag on the first — a function that decides from its arguments whether it is being
 * called by a founder or by staff is where an authorization mistake goes to hide.
 *
 * **There is no `requireStaff()` here**, for the same reason `tenants.ts` has none: the gate is
 * `provision_organization`'s first act, the caller reaches it in the `platform_staff` Postgres
 * role or not at all, and a TypeScript check in front of that would be a second authorization
 * system shadowing the real one (I12).
 */
export async function provisionOrganization(
  db: Db,
  input: {
    /** Who the business belongs to. They must already have an account. */
    ownerEmail: string;
    name: string;
    /** What the business will call its owner — per-tenant, never a global profile (D19). */
    displayName: string;
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

  // Deliberately shallow: this checks that a human typed something shaped like an address, and
  // the real answer comes from the database finding an account or not. A stricter pattern here
  // would reject a valid address somebody actually holds, and the failure it would prevent —
  // provisioning to nobody — already fails loudly one call later.
  if (!ownerEmail.includes('@')) {
    throw new DomainError('That is not an email address.', 'platform.owner_email_invalid');
  }

  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    throw new DomainError(
      'Say what the business should call its owner.',
      'platform.display_name_required',
    );
  }

  const { data, error } = await db.rpc('provision_organization', {
    p_owner_email: ownerEmail,
    p_name: name,
    // The founding role and its capabilities are the same through either door. A business
    // provisioned with a narrower owner role would be GOLD deciding what its owner may do.
    p_role: FOUNDING_ROLE,
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: displayName,
    // UTC is the absence of an assumption, exactly as at the other door — and it matters more
    // here, because the browser submitting this form is ours rather than the business's. A
    // timezone taken from the staff member's machine would put a Montreal business on a
    // London clock because of where somebody happened to be sitting (I9).
    p_timezone: (input.timezone || 'UTC') as string,
    p_currency: currency,
  });

  if (error) {
    throw new DomainError(error.message, 'platform.provision_failed');
  }

  return data as string;
}
