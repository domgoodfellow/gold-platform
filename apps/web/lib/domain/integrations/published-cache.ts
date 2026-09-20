import { unstable_cache } from 'next/cache';
import { getPublicDb } from '@/lib/db/public';
import { publishedConnectors } from './published';

export const CONNECTOR_CATALOGUE_CACHE_TAG = 'public-site:connectors';

/** The hour is the backstop for an edit that never went through the tagged action. */
export const getPublishedConnectors = unstable_cache(
  async () => publishedConnectors(getPublicDb()),
  ['published-connectors'],
  { tags: [CONNECTOR_CATALOGUE_CACHE_TAG], revalidate: 3600 },
);
