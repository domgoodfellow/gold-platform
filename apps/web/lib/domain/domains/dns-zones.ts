import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';

/**
 * Whether this business has already connected the DNS that answers for a hostname (work order 1,
 * section 4) — read-only, and never the records themselves: `apps/api`'s `app.services.dns` is
 * the one place that writes one (the vendor-shape-stays-at-the-edge rule, the no-vendor-SDK-in-domain rule, one axis over). This only tells the Domains screen
 * whether to say "GildOps is publishing these records automatically" or hand back the manual
 * copy-and-paste instruction it has always given.
 */

const CONNECTOR_KEY = 'cloudflare';
const ZONE_RESOURCE_TYPE = 'cloudflare_zone';

/** The zone names this business's own active Cloudflare connections can reach. RLS scopes the read. */
export async function listConnectedDnsZones(db: Db, organizationId: string): Promise<string[]> {
  const { data, error } = await db
    .from('integration_connections')
    .select('integration_resources(resource_type, display_name)')
    .eq('organization_id', organizationId)
    .eq('connector_key', CONNECTOR_KEY)
    .eq('status', 'active');
  if (error) throw fromDatabaseError(error, 'domains.dns_zones_read_failed');

  const zones = new Set<string>();
  for (const connection of data ?? []) {
    for (const resource of connection.integration_resources ?? []) {
      if (resource.resource_type === ZONE_RESOURCE_TYPE && resource.display_name) {
        zones.add(resource.display_name.toLowerCase());
      }
    }
  }
  return [...zones];
}

/** Whether a hostname falls under one of these connected zones — the same suffix match `app.services.dns` resolves a zone with. */
export function isDnsAutomated(hostname: string, zones: readonly string[]): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return zones.some((zone) => host === zone || host.endsWith(`.${zone}`));
}
