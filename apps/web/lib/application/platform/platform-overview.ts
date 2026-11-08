import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import type { Tenant } from '@/lib/domain/platform/tenants';

export type PlatformOverview = {
  organizations: {
    total: number;
    live: number;
    settingUp: number;
    /** Newest first, capped — the console's own table, not a claim about how many exist. */
    recent: Tenant[];
  };
  failures: {
    operational: number;
    providerReconciliation: number;
  };
  catalogue: {
    products: number;
    meters: number;
  };
  rates: {
    retail: number;
    provider: number;
  };
};

export async function platformOverview(
  db: Db,
  options: { recentLimit?: number } = {},
): Promise<PlatformOverview> {
  const { data, error } = await db.rpc('platform_health_summary', {
    p_recent_limit: options.recentLimit ?? 8,
  });
  if (error || !data) {
    throw error ? fromDatabaseError(error, 'platform.overview_forbidden') : new DomainError('Platform summary unavailable.', 'platform.overview_forbidden');
  }
  return data as unknown as PlatformOverview;
}
