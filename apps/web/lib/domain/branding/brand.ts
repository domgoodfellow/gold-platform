import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { LOGO_MAX_BYTES, LOGO_TYPES } from './logo-rules';
import { FONT_KEYS, isFontKey, normaliseBrandColour, type FontKey } from './palette';

/**
 * How one business looks, as rows rather than as a fork (the UI system's per-tenant theme, built small
 * because every control already reads a colour role rather than a literal — `docs/ui-system.md`). Not
 * the marketing surface, which stays deferred: no pages, blocks, or editor, just a colour, a
 * pair of fonts, and a logo. Reading is separated from rendering — this module knows what a
 * business chose, `palette.ts` knows what that renders as.
 */

export type Brand = {
  /** The primary colour as chosen, or null when this business has said nothing. Stored as `accent`. */
  accent: string | null;
  /**
   * Optional supporting and emphasis colours; null or absent derives from the primary at render time.
   * Absent on public surfaces that read a published single-colour brand.
   */
  secondary?: string | null;
  highlight?: string | null;
  /** Never null out here — see `getBrand` for why an unset pair is the platform's own. */
  headingFont: FontKey;
  bodyFont: FontKey;
  /** The object key in the public `brand` bucket, or null. */
  logoPath: string | null;
};

/** Not stored — an absent row means "has said nothing", the same way an absent operating hours set does. Writing these at founding would make that indistinguishable from choosing the platform's look on purpose. */
export const DEFAULT_BRAND: Brand = {
  accent: null,
  secondary: null,
  highlight: null,
  headingFont: 'sans',
  bodyFont: 'sans',
  logoPath: null,
};

/** Returns a whole `Brand`, never a nullable row — every caller is a renderer, and a renderer deciding what an absent row means would be a second place the default lives. */
export async function getBrand(db: Db, input: { organizationId: string }): Promise<Brand> {
  const { data, error } = await db
    .from('brand_settings')
    .select('accent, secondary, highlight, heading_font, body_font, logo_path')
    .eq('organization_id', input.organizationId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'brand.read_failed');
  }

  if (!data) return DEFAULT_BRAND;

  return {
    accent: data.accent,
    secondary: data.secondary,
    highlight: data.highlight,
    // Guarded rather than cast — an unknown string must not become a `FontKey` by assertion and reach a `style` attribute as `undefined`.
    headingFont: data.heading_font && isFontKey(data.heading_font) ? data.heading_font : 'sans',
    bodyFont: data.body_font && isFontKey(data.body_font) ? data.body_font : 'sans',
    logoPath: data.logo_path,
  };
}

/**
 * Choose a colour and a pair of fonts. No capability of its own — `organization.manage` already
 * covers a business's own settings. Nothing is checked for contrast here: a business may choose
 * any colour, and `palette.ts` guarantees it renders readably by deriving roles rather than by
 * refusing the colour.
 */
export async function setBrand(
  db: Db,
  input: {
    organizationId: string;
    /** Empty clears it, landing back on the platform's neutral look. */
    accent: string;
    headingFont: string;
    bodyFont: string;
    /** Optional roles. Omit both to keep the single-colour write; empty clears one. */
    secondary?: string;
    highlight?: string;
  },
): Promise<void> {
  await requireActor(db);

  const colour = (value: string) => (value.trim() === '' ? '' : normaliseBrandColour(value));
  const accent = colour(input.accent);
  const secondary = input.secondary === undefined ? undefined : colour(input.secondary);
  const highlight = input.highlight === undefined ? undefined : colour(input.highlight);
  if (accent === null || secondary === null || highlight === null) {
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

  // The palette write when a caller sends the optional roles; the original write otherwise, so a
  // single-colour caller can never clear a secondary or highlight it did not mention.
  const { error } = secondary !== undefined || highlight !== undefined
    ? await db.rpc('set_brand_palette', {
      p_organization_id: input.organizationId,
      p_accent: accent,
      p_secondary: secondary ?? '',
      p_highlight: highlight ?? '',
      p_heading_font: input.headingFont,
      p_body_font: input.bodyFont,
    })
    : await db.rpc('set_brand_settings', {
      p_organization_id: input.organizationId,
      p_accent: accent,
      p_heading_font: input.headingFont,
      p_body_font: input.bodyFont,
    });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot change how this business looks.', 'brand.forbidden');
    }
    if (error.code === '23514') {
      throw new DomainError('That is not a colour this platform can store.', 'brand.colour_invalid');
    }
    throw new DomainError(error.message, 'brand.write_failed');
  }
}

export { LOGO_MAX_BYTES, LOGO_TYPES };

/**
 * Put a logo up, and take down the one it replaces. Stored in a public bucket, not signed — a
 * logo's whole purpose is to be on a page a stranger opens, and a signed URL would mean a
 * booking page that can't be cached and a logo that expires. Bytes are written before the row
 * (same order as `uploadDocument`, same reason). The old object is deleted here, unlike a
 * document, because the caller is in the same act as the replacement.
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

  // A fresh name each time, not a fixed one, so a replaced logo is never served from a cache under the same URL.
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
    // Compensate — bytes with no row are worse to leave behind in a public bucket than a private one.
    await db.storage.from('brand').remove([key]);
    if (error.code === '42501') {
      throw new DomainError('You cannot change how this business looks.', 'brand.forbidden');
    }
    throw new DomainError(error.message, 'brand.logo_write_failed');
  }

  if (previous) {
    // Best effort, after the row is written — failing the whole call would leave the business looking at the logo they just replaced.
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

  // The row first this time — the bytes are what a stranger can still reach.
  await db.storage.from('brand').remove([previous]);
}

/** Public, not signed — see `uploadLogo`. Goes through the client so there is one answer to where storage lives. */
export function logoUrl(db: Db, logoPath: string): string {
  return db.storage.from('brand').getPublicUrl(logoPath).data.publicUrl;
}
