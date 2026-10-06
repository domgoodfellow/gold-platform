import { PAGE_SLUG_PATTERN, RESERVED_PAGE_SLUGS, type WebsitePage } from '@gold/schemas';

/**
 * Where a page lives on a business's own hostname. A path is one segment below the root and is
 * never a page's identity (that is its id) — it is only where the page is served today.
 */

export { RESERVED_PAGE_SLUGS };

/**
 * Whether a single path segment could name a published page. The proxy rewrites only these, so a
 * path the platform owns (a form, the portal, an API) is never shadowed by a business's page, and
 * anything that fails here falls through to exactly what it was before.
 */
export function isServablePageSlug(segment: string): boolean {
  return PAGE_SLUG_PATTERN.test(segment) && segment.length <= 60 && !(RESERVED_PAGE_SLUGS as readonly string[]).includes(segment);
}

export function pagePath(page: Pick<WebsitePage, 'isHome' | 'slug'>): string {
  return page.isHome ? '/' : `/${page.slug}`;
}

/** The page served at a path segment; no segment is the homepage. */
export function pageForSlug<P extends Pick<WebsitePage, 'isHome' | 'slug'>>(pages: P[], slug: string | null): P | null {
  if (slug === null || slug === '') return pages.find((page) => page.isHome) ?? null;
  return pages.find((page) => !page.isHome && page.slug === slug) ?? null;
}

export function slugFromName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return slug || 'page';
}

/** A path nobody on this site is using and the platform has not reserved. */
export function availableSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = PAGE_SLUG_PATTERN.test(base) ? base : slugFromName(base);
  let candidate = root;
  for (let n = 2; used.has(candidate) || (RESERVED_PAGE_SLUGS as readonly string[]).includes(candidate); n += 1) {
    candidate = `${root}-${n}`;
  }
  return candidate;
}
