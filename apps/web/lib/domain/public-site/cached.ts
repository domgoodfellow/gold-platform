import { unstable_cache } from 'next/cache';
import { getPublicDb } from '@/lib/db/public';
import { publishedGoldHomepage } from './public-site';

export const GOLD_HOMEPAGE_CACHE_TAG = 'public-site:gold:home';

/** Public output changes only when the publish action expires this tagged projection. */
export const getPublishedGoldHomepage = unstable_cache(
  async () => publishedGoldHomepage(getPublicDb()),
  ['published-gold-homepage'],
  { tags: [GOLD_HOMEPAGE_CACHE_TAG] },
);
