import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business says about itself, on a page strangers can see.
 *
 * **This module exists because the booking surface broke a Never.** `constraints.md`: "Never
 * hardcode a claim a business makes about itself — guarantees, trust points, service
 * assertions, section headings. Copy is configuration." The booking page shipped saying "Book
 * a time" and "This business is not taking bookings online at the moment" — the platform
 * speaking in a business's voice, on a URL that business puts on the side of a van.
 *
 * **D20 assumed booking could ship before marketing.** It defers the marketing surface because
 * "every word on a public page a business shows the world is a claim that business makes about
 * itself", and then permits booking — which is a public page. They are the same problem, and
 * the second one arrived first.
 *
 * What this is **not** is the marketing surface: no pages, no sections, no blocks, no editor,
 * and deliberately **no colour** — D23 rejects a per-tenant theme by name and says it lands
 * with the marketing surface and needs the same evidence. Copy is what the Never is about.
 *
 * The line this draws, and it is the useful part: **a business's own voice at the top of the
 * page; the platform's words only where they describe what the system is doing.** The Never
 * carves that out itself — "strings describing *application state* ('Loading', 'No results',
 * aria labels) stay in code." "Nothing free on this day" is application state. "We come to
 * you across Montréal" is a claim, and is a row.
 */

export type PublicProfile = {
  /** What to call this business publicly. Never null to a renderer — see `publicProfile`. */
  displayName: string;
  tagline: string | null;
  intro: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
};

const TAGLINE_MAX = 200;
const INTRO_MAX = 2000;

/**
 * One business's public copy, with its own name as the floor.
 *
 * **A business that has configured nothing still renders its own name**, because "it has said
 * nothing" must never resolve to the platform saying something on its behalf. That is the same
 * reading operating hours and the buffer take of an absent row, and it is the reason
 * `displayName` is not nullable out here even though the column is.
 */
export async function publicProfile(
  db: Db,
  input: { organizationId: string; fallbackName: string },
): Promise<PublicProfile> {
  const { data, error } = await db
    .from('organization_profiles')
    .select('display_name, tagline, intro, contact_email, contact_phone, address')
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'profile.read_failed');
  }

  return {
    displayName: data?.display_name ?? input.fallbackName,
    tagline: data?.tagline ?? null,
    intro: data?.intro ?? null,
    contactEmail: data?.contact_email ?? null,
    contactPhone: data?.contact_phone ?? null,
    address: data?.address ?? null,
  };
}

/**
 * Write it.
 *
 * No capability of its own: `organization.manage` already means "change this business's own
 * settings", and what a business says about itself is settings rather than a new authority.
 * A capability with no operation distinct from another is vocabulary nobody can act on
 * differently — the same argument the schema makes for configuring a board under `field.manage`.
 *
 * Empty means unset rather than empty: a business clearing its tagline is saying something,
 * and storing `''` would render a blank line where the reader expects nothing at all.
 */
export async function setPublicProfile(
  db: Db,
  input: {
    organizationId: string;
    displayName: string;
    tagline: string;
    intro: string;
    contactEmail: string;
    contactPhone: string;
    address: string;
  },
): Promise<void> {
  await requireActor(db);

  if (input.tagline.trim().length > TAGLINE_MAX) {
    throw new DomainError(
      `A tagline is at most ${TAGLINE_MAX} characters.`,
      'profile.tagline_too_long',
    );
  }
  if (input.intro.trim().length > INTRO_MAX) {
    throw new DomainError(
      `An introduction is at most ${INTRO_MAX} characters.`,
      'profile.intro_too_long',
    );
  }

  const { error } = await db.rpc('set_organization_profile', {
    p_organization_id: input.organizationId,
    p_display_name: input.displayName,
    p_tagline: input.tagline,
    p_intro: input.intro,
    p_contact_email: input.contactEmail,
    p_contact_phone: input.contactPhone,
    p_address: input.address,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot change what this business says about itself.',
        'profile.forbidden',
      );
    }
    if (error.code === '23514') {
      throw new DomainError('That is longer than this page allows.', 'profile.too_long');
    }
    throw new DomainError(error.message, 'profile.update_failed');
  }
}
