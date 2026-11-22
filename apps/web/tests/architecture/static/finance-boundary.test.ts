import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AREAS, WORKSPACES } from '@/lib/navigation';
import { PLATFORM_DESTINATIONS, PLATFORM_GROUPS } from '@/lib/platform-navigation';
import { PLATFORM_CAPABILITIES } from '@/lib/domain/platform/permissions';

/**
 * One financial authority (ADR-057, completed). Finance is the only place money is managed: every
 * business's own selling, and GildOps' — its plans, subscriptions, supplier costs and economics —
 * in GildOps' own organization's Finance, under Finance permissions. Administration runs the
 * platform and manages no money; platform authority opens no Finance. What a business buys from
 * GildOps stays Settings → Plan & usage. This test reads routes, registries and imports rather than
 * labels, so a second financial application cannot come back under a new name.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const FINANCE_ROUTES = join(WEB, 'app/organizations/[organizationId]/finance');
const ADMINISTRATION_ROUTES = join(WEB, 'app/organizations/[organizationId]/administration');
const rel = (path: string) => relative(WEB, path).split(sep).join('/');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const code = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const FINANCE_FILES = [...walk(FINANCE_ROUTES), ...walk(join(WEB, 'features/finance')), ...walk(join(WEB, 'lib/application/finance'))];
const ADMINISTRATION_FILES = [...walk(ADMINISTRATION_ROUTES), ...walk(join(WEB, 'features/platform')), ...walk(join(WEB, 'lib/application/platform'))];

/** What prices, sells, costs or accounts for money. Administration imports none of it. */
const MONEY = [
  /@\/lib\/domain\/commercial\/(economics|charges|infrastructure-costs|package-economics|terms)'/,
  /@\/lib\/domain\/pricing\//,
  /@\/lib\/domain\/billing\//,
  /@\/lib\/application\/finance\//,
  /@\/features\/finance\//,
  /\b(listProviderRates|listProviderCostRates|listRetailRates|recordPlanAssignment|recordPlanAgreement|recordCommercialTerm|listPlanPrices|organizationPlanPrice)\(/,
];

describe('Finance is the one place money is managed', () => {
  it('has routes, features and projections to inspect', () => {
    expect(FINANCE_FILES.length).toBeGreaterThan(20);
  });

  it('registers GildOps’ subscriptions, costs and economics as Finance destinations, each behind its own Finance permission', () => {
    expect(WORKSPACES.find((workspace) => workspace.key === 'finance')?.home).toBe('finance');
    const owned = AREAS.filter((area) => area.workspace === 'finance' && area.sidebar !== false).map((area) => area.segment);
    expect(owned).toEqual(['finance', 'finance-catalog', 'finance-subscriptions', 'finance-quotes', 'finance-invoices', 'finance-payments', 'finance-costs', 'finance-economics', 'finance-reports']);
    const area = (segment: string) => AREAS.find((candidate) => candidate.segment === segment)!;
    expect(area('finance-subscriptions')).toMatchObject({ route: 'finance/subscriptions', relevantCapabilities: ['subscription.read'], featureKeys: ['subscriptions'] });
    expect(area('finance-costs')).toMatchObject({ route: 'finance/costs', relevantCapabilities: ['cost.read'], featureKeys: ['supplier_costs'] });
    expect(area('finance-economics')).toMatchObject({ route: 'finance/economics', relevantCapabilities: ['cost.read'], featureKeys: ['cost_to_serve', 'package_economics'] });
    expect(area('finance-reports').relevantCapabilities).toEqual(['report.read']);
  });

  it('has a working page behind every GildOps money destination and record, never a redirect', () => {
    for (const path of ['subscriptions/page.tsx', 'subscriptions/[subscriberId]/page.tsx', 'costs/page.tsx', 'economics/page.tsx', 'economics/[subscriberId]/page.tsx', 'economics/packages/page.tsx']) {
      const source = code(join(FINANCE_ROUTES, path));
      expect(source, path).toMatch(/requireOperatingArea\(organizationId, 'finance-(subscriptions|costs|economics)'\)/);
      expect(source, path).not.toMatch(/^\s*redirect\(`\/platform/m);
    }
    expect(existsSync(join(FINANCE_ROUTES, 'plans'))).toBe(false);
  });

  it('authorizes every Finance write with a Finance permission in the business the form names', () => {
    const doors: [string, RegExp][] = [
      ['subscriptions/actions.ts', /capabilities\.includes\('subscription\.manage'\)/],
      ['costs/actions.ts', /capabilities\.includes\('cost\.manage'\)/],
      ['economics/packages/actions.ts', /capabilities\.includes\('cost\.manage'\)/],
      ['catalog/recurring-actions.ts', /capabilities\.includes\('price\.manage'\)/],
    ];
    for (const [path, permission] of doors) {
      const source = code(join(FINANCE_ROUTES, path));
      expect(source, path).toMatch(/requireOperatingArea\(/);
      expect(source, path).toMatch(permission);
    }
  });

  it('never lets platform authority stand in for a Finance permission', () => {
    const offenders = FINANCE_FILES.filter((file) => {
      const source = code(file).replace(/^import [^;]+;$/gm, '');
      // The one platform check Finance makes is Product Registry's own, on a plan's switch list.
      const foreign = source.replace(/requirePlatformCapability\('platform\.catalogue'\)/g, '');
      return /requirePlatformCapability|requirePlatformArea|requirePlatformScope|platform\.commercial|isGoldInternal/.test(foreign);
    });
    expect(offenders.map(rel)).toEqual([]);
  });

  it('imports no Administration screen or route', () => {
    const offenders = FINANCE_FILES.filter((file) => /@\/features\/platform\/|@\/app\/organizations\/\[organizationId\]\/administration|@\/lib\/application\/platform\//.test(code(file)));
    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('a plan has one commercial authority and one creation path', () => {
  it('is created only in GildOps’ Catalog & Pricing, as a recurring item', () => {
    const callers = [...walk(join(WEB, 'app')), ...walk(join(WEB, 'features')), ...walk(join(WEB, 'lib'))]
      .filter((file) => /\bcreatePlanItem\(|'create_plan_item'/.test(code(file)))
      .map(rel)
      .sort();
    expect(callers).toEqual(['app/organizations/[organizationId]/finance/catalog/recurring-actions.ts', 'lib/domain/catalogue/plans.ts']);
    const anywhere = [...walk(join(WEB, 'app')), ...walk(join(WEB, 'features')), ...walk(join(WEB, 'lib'))].filter((file) => /'create_plan'|\bcreatePlan\(/.test(code(file)));
    expect(anywhere.map(rel)).toEqual([]);
  });

  it('edits what a plan switches on from the plan’s own Finance record, proving the Finance area and Product Registry authority together', () => {
    const actions = code(join(FINANCE_ROUTES, 'catalog/plan-switch-actions.ts'));
    expect(actions).toMatch(/requireOperatingArea\(organizationId, 'finance-catalog'\)/);
    expect(actions).toMatch(/requirePlatformCapability\('platform\.catalogue'\)/);
    expect(actions).toMatch(/plan\.priceBookItemId !== itemId/);
    expect(existsSync(join(ADMINISTRATION_ROUTES, 'catalog/plans'))).toBe(false);
  });

  it('reads a recurring item only after the catalog area and the recurring-items feature are proven', () => {
    const route = code(join(FINANCE_ROUTES, 'catalog/[itemId]/page.tsx'));
    const guard = route.indexOf("requireOperatingArea(organizationId, 'finance-catalog')");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(route.indexOf("featureAvailability.has('recurring_items')"));
    expect(route.indexOf("featureAvailability.has('recurring_items')")).toBeLessThan(route.indexOf('loadRecurringItem(db'));
  });
});

describe('Administration runs the platform and manages no money', () => {
  it('has no financial group or destination', () => {
    expect(PLATFORM_GROUPS.map((group) => group.key)).toEqual(['product-registry', 'integration-registry', 'infrastructure', 'reliability']);
    const financial = PLATFORM_DESTINATIONS.filter((destination) => /plan|pric|billing$|vendor-rate|economics|usage|subscription|cost|commercial/.test(`${destination.key} ${destination.path}`));
    expect(financial).toEqual([]);
  });

  it('has no route for plans, prices, billing, usage economics, supplier rates or portfolio economics', () => {
    for (const path of ['catalog/plans', 'plans', 'pricing', 'billing', 'usage', 'vendor-rates', 'package-economics', 'economics', 'organizations/[targetOrganizationId]/commercial']) {
      expect(existsSync(join(ADMINISTRATION_ROUTES, path)), path).toBe(false);
    }
    expect(existsSync(join(WEB, 'app/platform'))).toBe(false);
  });

  it('imports nothing that prices, sells or costs', () => {
    const offenders = ADMINISTRATION_FILES.flatMap((file) => MONEY.filter((pattern) => pattern.test(code(file))).map((pattern) => `${rel(file)} ${pattern}`));
    expect(offenders).toEqual([]);
  });

  it('has no platform permission over money', () => {
    expect([...PLATFORM_CAPABILITIES].sort()).toEqual(['platform.catalogue', 'platform.health', 'platform.organizations', 'platform.providers']);
  });
});
