import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business says about itself, on a page strangers can see. Exists because copy is
 * configuration, not something the platform says on a business's behalf — a public page must
 * carry the business's own voice, never a platform claim ("Book a time now!"). No colour here;
 * that's the marketing surface the UI system defers separately.
 */

export type PublicProfile = {
  /** Never null to a renderer — see `publicProfile`. */
  displayName: string;
  tagline: string | null;
  intro: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
};

const TAGLINE_MAX = 200;
const INTRO_MAX = 2000;

/** A business that's configured nothing still renders its own name — "said nothing" must never become the platform speaking for it. */
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
    throw fromDatabaseError(error, 'profile.read_failed');
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

/** No capability of its own — `organization.manage` already covers a business's own settings. Empty means unset, not blank: storing `''` would render a blank line where the reader expects nothing. */
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
    throw fromDatabaseError(error, 'profile.update_failed');
  }
}
