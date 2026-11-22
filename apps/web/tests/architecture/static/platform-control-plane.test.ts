import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/lib/navigation';

const root = resolve(import.meta.dirname, '..', '..', '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

/**
 * Every migration under `supabase/migrations/`, concatenated. The platform-economics separation's own catalogue is additive —
 * `platform_products` gains a row in a *new* migration when a module gains one (the shape
 * `20260913000001`/`20260913000002` already used for the rest of the catalogue), never an edit
 * to the migration that first created the table (the forward-only migration rule: a migration that may have been applied is
 * never modified). A single-file read would fail the day a module arrived after that first one.
 */
const migrationsRoot = resolve(root, '../../supabase/migrations');
const allMigrations = () =>
  readdirSync(migrationsRoot)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(resolve(migrationsRoot, name), 'utf8'))
    .join('\n');

describe('platform control-plane scope boundaries', () => {
  it('reads no prices, rates or money anywhere a business is administered (ADR-057)', () => {
    const base = 'app/organizations/[organizationId]/administration';
    for (const path of ['catalog/meters/page.tsx', 'catalog/products/page.tsx', 'catalog/products/[productKey]/page.tsx', 'providers/page.tsx', 'organizations/[targetOrganizationId]/page.tsx', 'organizations/[targetOrganizationId]/usage/page.tsx', 'billing-deliveries/page.tsx']) {
      expect(source(`${base}/${path}`), path).not.toMatch(/listProviderRates|listRetailRates|listPlanPrices|organizationPlanPrice|formatMoney|formatMicrosMoney|listEconomicsEvents|listCostComponents/);
    }
  });

  it('keeps a business’s subscription in GildOps’ Finance and its provider tasks in Administration', () => {
    const record = source('app/organizations/[organizationId]/administration/organizations/[targetOrganizationId]/page.tsx');
    const providers = source('app/organizations/[organizationId]/administration/organizations/[targetOrganizationId]/providers/page.tsx');
    // The record links to the subscription, for members who may read it, and writes none of it.
    expect(record).toMatch(/finance\/subscriptions\/\$\{organizationId\}/);
    expect(record).toContain("may('subscription.read')");
    expect(record).not.toMatch(/recordPlanAssignment|recordPlanAgreement|recordCommercialTerm|AssignPlanSheet/);
    expect(source('lib/application/finance/subscriptions.ts')).toContain('listOrganizationTerms');
    expect(providers).toContain('listProviderBindings');
    expect(providers).toContain('listProviderResources');
  });

  it('maps every code-backed module to a commercial product key', () => {
    const migrations = allMigrations();
    for (const capability of MODULES) expect(migrations).toContain(`'module:${capability.key}'`);
  });

  it('guards all platform child routes in the shared layout', () => {
    const layout = source('app/organizations/[organizationId]/administration/layout.tsx');
    expect(layout).toContain('requirePlatformScope(organizationId)');
    const guard = source('lib/route/platform.ts');
    // Platform authority is the caller's own platform_staff row, read live; none means no Platform.
    expect(guard).toContain('platformPermissions(db)');
    expect(guard).toContain('permissions.size === 0');
    expect(guard).toContain('notFound()');
  });

  it('never filters platform data by the organization the URL is nested under', () => {
    // `goldId` is the context a page is drawn in: it may be read from the route, spelled into a link
    // and handed to a component that spells one. Anything else — a domain read, a query, a filter —
    // would turn a URL into a data scope. Providers, catalogue and billing are not GOLD's rows.
    const allowed = [
      /organizationId: goldId/g,
      /platformHref\(goldId,/g,
      /platformAncestry\(goldId,/g,
      /requirePlatformArea\(goldId,/g,
      /goldId=\{goldId\}/g,
      /\{ goldId: string \}/g,
      /^\s*goldId(,|: string;)\s*$/gm,
      /const \{ goldId \} = useParams/g,
      // Plans & Add-ons is spelled as a link into Finance, GOLD's own workspace, the same
      // "read from the route, spelled into a link" allowance as `platformHref(goldId,`.
      /\/organizations\/\$\{goldId\}\/finance\//g,
      // Phase C's loader+Screen pairs (Slice 9) take `goldId` as a prop, destructured and typed
      // inline on one line rather than one-per-line — the same "read from the route, spelled into
      // a link" fact as the patterns above, just written where a single-expression component
      // signature puts it.
      /\{ goldId,/g,
      /goldId: string[;,]/g,
      // The scope guard is asked of the route's organization, which it proves is GildOps'.
      /requirePlatformScope\(goldId\)/g,
      // GildOps' own CRM: which of its customers this business is, read in GildOps' organization.
      /customerForTenant\(db, \{ organizationId: goldId,/g,
      /\/organizations\/\$\{goldId\}\/crm\//g,
    ];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk(resolve(root, 'app/organizations/[organizationId]/administration'));
    walk(resolve(root, 'features/platform'));
    expect(files.length).toBeGreaterThan(30);
    const offenders = files.filter((file) => {
      let text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const pattern of allowed) text = text.replace(pattern, '');
      return /\bgoldId\b/.test(text);
    });
    expect(offenders.map((file) => file.slice(root.length))).toEqual([]);
  });
});
