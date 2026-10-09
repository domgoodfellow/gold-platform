/** What a logo may weigh and what it may be, matching the bucket's own limit. Kept apart from `brand.ts` so the upload form can show and pre-check the same limits without importing server code. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const;
