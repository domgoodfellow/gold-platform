import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AREAS, WORKSPACES } from '@/lib/navigation';
import { PLATFORM_DESTINATIONS } from '@/lib/platform-navigation';

/**
 * Three financial views stay separate: Finance is each organization's own selling (customer to
 * business, ADR-051); what a business buys from GildOps is Settings → Plan & usage; GildOps'
 * private provider economics, and during transition the existing platform-billing records, are
 * Platform. Finance reaching into either of the others is how Finance Home once became a Plan and
 * subscription dashboard, so this test reads the imports rather than the words. Moving GildOps'
 * selling into its operating Organization's Finance means building it on Finance's own
 * capabilities, never importing these planes.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const FINANCE_ROUTES = join(WEB, 'app/organizations/[organizationId]/finance');
const rel = (path: string) => relative(WEB, path).split(sep).join('/');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** Everything Finance owns: its routes (bookmark redirects aside), its feature UI and its application projections. */
const FINANCE_FILES = [
  ...walk(FINANCE_ROUTES).filter((file) => !/redirect\(/.test(code(file))),
  ...walk(join(WEB, 'features/finance')),
  ...walk(join(WEB, 'lib/application/finance')),
];

/** Domain areas that belong to what a business buys from GildOps, or to GildOps' own control plane. */
const COMMERCIAL_PLANE = [
  /@\/lib\/domain\/catalogue\//,
  /@\/lib\/domain\/commercial\//,
  /@\/lib\/domain\/platform-billing\//,
  /@\/lib\/domain\/platform\//,
  /@\/lib\/adapters\/platform-billing/,
  /@\/lib\/route\/platform/,
  /@\/lib\/domain\/tenancy\/gold-internal/,
  /@\/lib\/application\/platform\//,
  /@\/features\/platform\//,
];

describe('Finance is tenant Financial Operations', () => {
  it('guards planning before tenant reads and offers no persistence or publication path', () => {
    const route = code(join(FINANCE_ROUTES, 'reports/page.tsx'));
    expect(route).toMatch(/requireOperatingArea\(organizationId, 'finance-reports'\)/);
    expect(route.indexOf("requireOperatingArea(organizationId, 'finance-reports')")).toBeLessThan(route.indexOf('listPriceBookItems(db'));
    const planner = code(join(WEB, 'features/finance/pricing-planner.tsx'));
    const calculation = code(join(WEB, 'lib/domain/pricing/planning.ts'));
    expect(planner + calculation).not.toMatch(/\.from\(|\.rpc\(|updatePriceBookItem|localStorage|sessionStorage|use server/);
    expect(calculation).not.toMatch(/import .* from/);
  });
  it('has routes, features and projections to inspect', () => {
    expect(FINANCE_FILES.length).toBeGreaterThan(8);
  });

  it('imports nothing from the commercial plane or the platform control plane', () => {
    const offenders = FINANCE_FILES.flatMap((file) =>
      COMMERCIAL_PLANE.filter((pattern) => pattern.test(code(file))).map((pattern) => `${rel(file)} imports ${pattern}`),
    );
    expect(offenders).toEqual([]);
  });

  it('has no special branch for GildOps own organization', () => {
    const offenders = FINANCE_FILES.filter((file) => /isGoldInternal|platformPermissions|platform\.commercial/.test(code(file)));
    expect(offenders.map(rel)).toEqual([]);
  });

  it('answers from the canonical financial authorities, and writes none of its own', () => {
    const projections = walk(join(WEB, 'lib/application/finance'));
    const source = projections.map(code).join('\n');
    expect(source).toMatch(/@\/lib\/domain\/billing\/invoices/);
    expect(source).toMatch(/@\/lib\/domain\/pricing\/prices/);
    expect(source).toMatch(/@\/lib\/domain\/reporting\/financials/);
    // A second total would be a second price calculation; standing and totals are the domain's.
    expect(source).not.toMatch(/\.from\(['"]/);
    expect(source).not.toMatch(/unitAmountMinor\s*\*/);
  });

  it('keeps Finance workspace ownership in the registry: Dashboard, Catalog & Pricing, Quotes, Invoices, Payments and Financial reports, with payment configuration behind Configure', () => {
    expect(WORKSPACES.find((workspace) => workspace.key === 'finance')?.home).toBe('finance');
    const owned = AREAS.filter((area) => area.workspace === 'finance' && area.sidebar !== false).map((area) => area.segment);
    expect(owned).toEqual(['finance', 'finance-catalog', 'finance-quotes', 'finance-invoices', 'finance-payments', 'finance-reports']);
    expect(AREAS.find((area) => area.segment === 'finance-reports')?.relevantCapabilities).toEqual(['report.read']);
    const pricing = AREAS.find((area) => area.segment === 'pricing');
    expect(pricing?.workspace).toBe('finance');
    expect(pricing?.sidebar).toBe(false);
  });
});

describe("GildOps' plans are recurring items of its own Finance (ADR-057)", () => {
  it('leaves Platform only what a plan switches on, under Product Registry', () => {
    expect(PLATFORM_DESTINATIONS.find((destination) => destination.key === 'plans')).toMatchObject({ path: 'catalog/plans', requires: 'platform.catalogue', under: 'product-registry' });
    expect(PLATFORM_DESTINATIONS.find((destination) => destination.key === 'pricing')).toBeUndefined();
    const registry = [
      ...walk(join(WEB, 'app/platform/catalog/plans')),
      ...walk(join(WEB, 'features/platform/plans')),
      join(WEB, 'lib/application/platform/plan-switches.ts'),
    ];
    const pricing = registry.filter((file) => /@\/lib\/domain\/pricing\/|price_book_item_prices|record_item_price|platform-billing/.test(code(file)));
    expect(pricing.map(rel)).toEqual([]);
  });

  it('keeps the retired Platform and Finance plan addresses as redirects that end in Product Registry or Finance', () => {
    for (const path of ['app/platform/plans/page.tsx', 'app/platform/plans/[planKey]/page.tsx', 'app/platform/pricing/page.tsx']) {
      const source = code(join(WEB, path));
      expect(source, path).toMatch(/redirect\(/);
      expect(source, path).not.toMatch(/getDb|@\/lib\/domain|@\/features\//);
      expect(source, path).toMatch(/\/platform\/catalog\/plans|\/finance\/catalog/);
    }
    for (const file of walk(join(FINANCE_ROUTES, 'plans'))) {
      expect(code(file), rel(file)).toMatch(/redirect\(`\/organizations\/\$\{organizationId\}\/finance\/catalog/);
    }
  });

  it('reads a recurring item only after the catalog area and the recurring-items feature are proven', () => {
    const route = code(join(FINANCE_ROUTES, 'catalog/[itemId]/page.tsx'));
    const guard = route.indexOf("requireOperatingArea(organizationId, 'finance-catalog')");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(route.indexOf("featureAvailability.has('recurring_items')"));
    expect(route.indexOf("featureAvailability.has('recurring_items')")).toBeLessThan(route.indexOf('loadRecurringItem(db'));
  });
});

describe("During transition, GildOps' portfolio economics stays in Platform (ADR-051)", () => {
  it('is a registered Platform destination behind the commercial permission', () => {
    expect(PLATFORM_DESTINATIONS.find((destination) => destination.key === 'portfolio-economics')?.requires).toBe('platform.commercial');
  });

  it('is served from /platform, and what remains under /finance for it is only a redirect', () => {
    expect(existsSync(join(WEB, 'app/platform/economics/page.tsx'))).toBe(true);
    const leftovers = walk(join(FINANCE_ROUTES, 'economics'));
    expect(leftovers.length).toBeGreaterThan(0);
    for (const file of leftovers) {
      expect(code(file), `${rel(file)} must only redirect`).toMatch(/redirect\(/);
      expect(code(file), `${rel(file)} must not read data`).not.toMatch(/getDb|requireOrganization|\.from\(/);
    }
  });

  it('has no feature or projection left under Finance', () => {
    expect(existsSync(join(WEB, 'lib/application/finance/economics-overview.ts'))).toBe(false);
  });
});
