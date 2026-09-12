import { unstable_cache } from 'next/cache';
import { updateTag } from 'next/cache';
import { getPublicDb } from '@/lib/db/public';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { publishedGoldHomepage } from './public-site';

export const GOLD_HOMEPAGE_CACHE_TAG = 'public-site:gold:home';

/** Public output changes only when the publish action expires this tagged projection. */
export const getPublishedGoldHomepage = unstable_cache(
  async () => publishedGoldHomepage(getPublicDb()),
  ['published-gold-homepage'],
  { tags: [GOLD_HOMEPAGE_CACHE_TAG] },
);

/**
 * Expire the root projection only when the changed organization is the one it references.
 *
 * This deliberately reads the uncached narrow projection: consulting the cached value to decide
 * whether to expire that same value would make a stale cache its own authority. It is called only
 * from Server Actions, where Next permits `updateTag` and guarantees read-your-own-writes.
 */
export async function invalidateGoldHomepageIfReferenced(
  db: Db,
  organizationId: string,
): Promise<void> {
  try {
    const published = await publishedGoldHomepage(db);
    if (published.organizationId === organizationId) updateTag(GOLD_HOMEPAGE_CACHE_TAG);
  } catch (error) {
    // An unconfigured deployment or a tenant with no selected root site has no public cache to
    // invalidate. Infrastructure/schema errors still surface rather than disguising a stale page.
    if (error instanceof DomainError && error.code === 'public_site.not_published') return;
    throw error;
  }
}
