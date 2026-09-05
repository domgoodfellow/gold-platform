import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { FONT_KEYS, isFontKey, normaliseBrandColour, type FontKey } from './palette';

/**
 * How one business looks, as rows rather than as a fork.
 *
 * **This is D23's per-tenant theme, built.** That record refuses one and defers it to the
 * marketing surface, and `constraints.md` carries the amendment explaining what changed. What
 * makes it small is that the deferral was honoured properly: `ui-spec.md` §3 requires every
 * control to read a colour role rather than a literal, so this module changes where the values
 * come from and no control at all.
 *
 * **It is not the marketing surface, and that stays deferred.** No pages, no blocks, no editor.
 * A business gets one colour, a pair of fonts and a logo — the things that make a page look like
 * theirs rather than like a specification.
 *
 * Reading is separated from rendering on purpose: this module knows what a business chose and
 * `palette.ts` knows what that renders as. A screen asks for a role and derives nothing.
 */

export type Brand = {
  /** The colour as chosen, or null when this business has said nothing. */
  accent: string | null;
  /** Never null out here — see `getBrand` for why an unset pair is the platform's own. */
  headingFont: FontKey;
  bodyFont: FontKey;
  /** The object key in the public `brand` bucket, or null. */
  logoPath: string | null;
};

/**
 * The defaults a business that has chosen nothing renders as.
 *
 * **Not stored, and that distinction is the point.** Writing these into the row at founding
 * would make a business that never opened the brand screen indistinguishable from one that
 * chose the platform's own look on purpose — and the first change to a default would then reach
 * only the second kind. An absent row means *has said nothing*, exactly as an absent operating
 * hours set does.
 */
export const DEFAULT_BRAND: Brand = {
  accent: null,
  headingFont: 'sans',
  bodyFont: 'sans',
  logoPath: null,
};

/**
 * What this business looks like, with the platform's own look as the floor.
 *
 * Returns a whole `Brand` rather than a nullable row, because every caller is a renderer and a
 * renderer that has to decide what an absent row means is a second place the default lives.
 */
export async function getBrand(db: Db, input: { organizationId: string }): Promise<Brand> {
  const { data, error } = await db
    .from('brand_settings')
    .select('accent, heading_font, body_font, logo_path')
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'brand.read_failed');
  }

  if (!data) return DEFAULT_BRAND;

  return {
    accent: data.accent,
    // Guarded rather than cast. The column's check constraint is the guarantee and this is the
    // boundary where an unknown string would otherwise become a `FontKey` by assertion — which
    // is how a family the renderer cannot map reaches a `style` attribute as `undefined`.
    headingFont: data.heading_font && isFontKey(data.heading_font) ? data.heading_font : 'sans',
    bodyFont: data.body_font && isFontKey(data.body_font) ? data.body_font : 'sans',
    logoPath: data.logo_path,
  };
}

/**
 * Choose a colour and a pair of fonts.
 *
 * No capability of its own: `organization.manage` already means *change this business's own
 * settings*, and how it looks is settings. A capability nobody would grant separately is
 * vocabulary rather than authority — the same argument `setPublicProfile` makes, about the same
 * kind of claim.
 *
 * **Nothing is checked for contrast here, and that is deliberate.** A business may choose any
 * colour at all; what the platform guarantees is that whatever they chose renders readably,
 * which `palette.ts` does by deriving the roles rather than by refusing the colour. Refusing
 * would be the platform telling a business its own brand is not allowed.
 */
export async function setBrand(
  db: Db,
  input: {
    organizationId: string;
    /** Empty clears it, and clearing lands back on the platform's neutral look. */
    accent: string;
    headingFont: string;
    bodyFont: string;
  },
): Promise<void> {
  await requireActor(db);

  const accent = input.accent.trim() === '' ? '' : normaliseBrandColour(input.accent);
  if (accent === null) {
    throw new DomainError(
      'A colour is a hex value such as #1f6feb.',
      'brand.colour_invalid',
    );
  }

  for (const [label, value] of [
    ['heading', input.headingFont],
    ['body', input.bodyFont],
  ] as const) {
    if (!isFontKey(value)) {
      throw new DomainError(
        `That is not a ${label} lettering this platform has. Choose one of: ${FONT_KEYS.join(', ')}.`,
        'brand.font_unknown',
      );
    }
  }

  const { error } = await db.rpc('set_brand_settings', {
    p_organization_id: input.organizationId,
    p_accent: accent,
    p_heading_font: input.headingFont,
    p_body_font: input.bodyFont,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change how this business looks.', 'brand.forbidden');
    }
    // The column's own check. Reachable only through a caller that skipped `normaliseBrandColour`
    // above, which is exactly the belt the check constraint is.
    if (error.code === '23514') {
      throw new DomainError('That is not a colour this platform can store.', 'brand.colour_invalid');
    }
    throw new DomainError(error.message, 'brand.write_failed');
  }
}

/** What a logo may weigh and what it may be, matching the bucket's own limit. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const;

/**
 * Put a logo up, and take down the one it replaces.
 *
 * **The bytes go in a public bucket, which is the one place this platform does that**, and the
 * migration carries the reasoning: `constraints.md`'s rule is about files whose *existence* is
 * confidential, and a logo's whole purpose is to be on a page a stranger opens. Signing a URL
 * for it would mean a booking page that cannot be cached and a logo that expires.
 *
 * **The old object is deleted, unlike a document.** `documents` has no delete path because
 * deleting one is a feature with no caller; here the caller is in the same act — a business
 * that replaced its logo would otherwise leave the previous one readable at a durable public
 * URL for ever, which is the opposite of what replacing it meant.
 *
 * Bytes are written before the row, so a failure leaves an unreferenced object rather than a
 * row pointing at nothing — the same order `uploadDocument` takes and for the same reason.
 */
export async function uploadLogo(
  db: Db,
  input: { organizationId: string; file: File },
): Promise<void> {
  await requireActor(db);

  if (input.file.size === 0) {
    throw new DomainError('That file is empty.', 'brand.logo_empty');
  }
  if (input.file.size > LOGO_MAX_BYTES) {
    throw new DomainError('A logo is at most 2 MB.', 'brand.logo_too_large');
  }
  if (!(LOGO_TYPES as readonly string[]).includes(input.file.type)) {
    throw new DomainError(
      'A logo is a PNG, JPEG, SVG or WebP image.',
      'brand.logo_type_unsupported',
    );
  }

  const previous = (await getBrand(db, input)).logoPath;

  // The tenant id leads the key, which is what the bucket's policies enforce — a business can
  // only write under its own id. The rest is a fresh name each time rather than a fixed one, so
  // a replaced logo is never served from a cache under the same URL.
  const key = `${input.organizationId}/${crypto.randomUUID()}`;

  const upload = await db.storage.from('brand').upload(key, input.file, {
    contentType: input.file.type,
    upsert: false,
  });
  if (upload.error) {
    throw new DomainError(upload.error.message, 'brand.logo_upload_failed');
  }

  const { error } = await db.rpc('set_brand_logo', {
    p_organization_id: input.organizationId,
    p_logo_path: key,
  });

  if (error) {
    // Compensate: bytes with no row are unreachable, and leaving them in a *public* bucket
    // would be worse than in a private one.
    await db.storage.from('brand').remove([key]);
    if (error.code === '42501') {
      throw new DomainError('You cannot change how this business looks.', 'brand.forbidden');
    }
    throw new DomainError(error.message, 'brand.logo_write_failed');
  }

  if (previous) {
    // Best effort, and deliberately after the row is written. A failure here leaves an orphaned
    // object, which is untidy; failing the whole call would leave the business looking at the
    // logo they just replaced, which is wrong.
    await db.storage.from('brand').remove([previous]);
  }
}

/** Take the logo down without replacing it. */
export async function removeLogo(db: Db, input: { organizationId: string }): Promise<void> {
  await requireActor(db);

  const previous = (await getBrand(db, input)).logoPath;
  if (!previous) return;

  const { error } = await db.rpc('set_brand_logo', {
    p_organization_id: input.organizationId,
    p_logo_path: '',
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change how this business looks.', 'brand.forbidden');
    }
    throw new DomainError(error.message, 'brand.logo_write_failed');
  }

  // The row first this time, because the bytes are what a stranger can still reach: a row
  // pointing at a deleted object renders no logo, and an object with no row is a public URL
  // nobody took down.
  await db.storage.from('brand').remove([previous]);
}

/**
 * Where a logo is actually served from.
 *
 * The bucket is public, so this is a plain URL and not a signed one — see `uploadLogo`. It goes
 * through the client rather than being assembled from an environment variable, so there is one
 * answer to where storage lives.
 */
export function logoUrl(db: Db, logoPath: string): string {
  return db.storage.from('brand').getPublicUrl(logoPath).data.publicUrl;
}
