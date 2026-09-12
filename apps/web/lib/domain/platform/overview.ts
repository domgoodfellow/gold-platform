import type { Db } from '@/lib/db/types';
import { listMeters, listProducts, listProviderRates, listRetailRates } from '@/lib/domain/commercial/catalogue';
import { countProviderSyncFailures } from '@/lib/domain/commercial/usage';
import { DomainError } from '@/lib/domain/errors';
import { countFailures, isPlatformStaff, listTenants, type Tenant } from '@/lib/domain/platform/tenants';

/**
 * What `/platform`'s landing screen reads. A composition over already-authoritative reads
 * (`listTenants`, `countFailures`, the commercial catalogue), not a new calculation — every
 * number here is a count of rows those functions already return, grouped the way the screen
 * needs them grouped. Nothing here totals money or crosses a currency; see `constraints.md`'s
 * "Decided, not yet built" table for what was deliberately left off this screen (usage, revenue,
 * margin, entitlement gaps) and why — no platform-wide aggregate exists yet for any of those.
 */
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

const RECENT_ORGANIZATIONS = 8;

export async function platformOverview(db: Db): Promise<PlatformOverview> {
  // Every reader this composes now grants `authenticated` a soft, row-filtered "nothing to show"
  // for a non-staff caller rather than a hard privilege error (20260915000001 moved staff off a
  // separate Postgres role) — `listMeters`/`listRetailRates` were already tenant-visible on
  // purpose, and the console-only readers just stopped being the accidental thing that made this
  // whole composition reject. Without this, a member would get a real response back: mostly
  // zeros, but a response, not the refusal this screen is meant to be behind. Explicit, the same
  // shape `organization_commercial_summary` uses on the database side of this exact problem.
  if (!(await isPlatformStaff(db))) {
    throw new DomainError('Only platform staff may read this.', 'platform.overview_forbidden');
  }

  const [{ tenants, total }, operational, providerReconciliation, products, meters, retailRates, providerRates] =
    await Promise.all([
      listTenants(db),
      countFailures(db),
      countProviderSyncFailures(db),
      listProducts(db),
      listMeters(db),
      listRetailRates(db),
      listProviderRates(db),
    ]);

  const settingUp = tenants.filter((tenant) => tenant.operationalState === 'setup').length;

  return {
    organizations: {
      total,
      // `live`/`settingUp` are counted over the page `listTenants` actually returned (capped at
      // `TENANT_PAGE`), the same honesty `listTenants` itself already applies to `total` — a
      // console with more tenants than one page holds should undercount rather than guess.
      live: tenants.length - settingUp,
      settingUp,
      recent: tenants.slice(0, RECENT_ORGANIZATIONS),
    },
    failures: {
      operational,
      providerReconciliation,
    },
    catalogue: {
      products: products.filter((product) => product.saleStatus !== 'archived').length,
      meters: meters.length,
    },
    rates: {
      retail: retailRates.length,
      provider: providerRates.length,
    },
  };
}
