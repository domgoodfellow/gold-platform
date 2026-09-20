import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { ConnectorStatus } from './connectors';

/**
 * What GOLD's public site says about connectors (D55): the published projection, public columns
 * only, read without a session. Editing a connector in Platform → Integrations expires
 * `CONNECTOR_CATALOGUE_CACHE_TAG` (`published-cache.ts`), so the public catalogue changes without a
 * deployment. This file holds no cache and no server-only import so a test can drive it.
 */

export type PublishedConnector = {
  key: string;
  name: string;
  category: string;
  suite: string | null;
  status: ConnectorStatus;
  slug: string | null;
  summary: string;
  description: string;
  logoUrl: string | null;
  apps: string[];
};

export async function publishedConnectors(db: Db): Promise<PublishedConnector[]> {
  const { data, error } = await db.rpc('published_connectors');
  if (error) throw new DomainError(error.message, 'integrations.published_failed');
  return (data ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    category: row.category,
    suite: row.suite,
    status: row.status as ConnectorStatus,
    slug: row.marketing_slug,
    summary: row.marketing_summary,
    description: row.marketing_description,
    logoUrl: row.icon_ref ? db.storage.from('connector-logos').getPublicUrl(row.icon_ref).data.publicUrl : null,
    apps: Array.isArray(row.apps) ? (row.apps as string[]) : [],
  }));
}

/** Group in catalogue order; a category is whatever the catalogue says, never a list kept here. */
export function groupByCategory(connectors: readonly PublishedConnector[]): { category: string; items: PublishedConnector[] }[] {
  const groups = new Map<string, PublishedConnector[]>();
  for (const connector of connectors) groups.set(connector.category, [...(groups.get(connector.category) ?? []), connector]);
  return [...groups].map(([category, items]) => ({ category, items }));
}
