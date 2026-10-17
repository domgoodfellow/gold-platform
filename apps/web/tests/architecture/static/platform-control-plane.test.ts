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
  it('owns global rates in Pricing without an organization id', () => {
    const page = source('app/organizations/[organizationId]/platform/pricing/page.tsx');
    expect(page).toContain('listProviderRates(db)');
    expect(page).toContain('listRetailRates(db)');
    // The only organization the route names is GOLD's own, as the context the page is drawn in.
    expect(page.replace(/PageProps<[^>]*>/, '').replace('organizationId: goldId', '')).not.toContain('organizationId');
    expect(source('features/platform/pricing/rate-forms.tsx').replace(/@\/app\/organizations\/\[organizationId\]\/platform/g, '')).not.toContain('organizationId');
  });

  it('keeps tenant commercial and provider tasks in their tenant routes', () => {
    const commercial = source('app/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/commercial/page.tsx');
    const providers = source('app/organizations/[organizationId]/platform/organizations/[targetOrganizationId]/providers/page.tsx');
    // Phase C (Slice 9) moved the commercial route's read into its application-layer loader; the
    // page itself now only resolves params, guards and renders the Screen with that loader's model.
    const commercialModel = source('lib/application/platform/organization-commercial.ts');
    expect(commercialModel).toContain('listOrganizationTerms');
    expect(commercial).not.toContain('RecordProviderRateForm');
    expect(commercial).not.toContain('RecordRetailRateForm');
    expect(providers).toContain('listProviderBindings');
    expect(providers).toContain('listProviderResources');
  });

  it('maps every code-backed module to a commercial product key', () => {
    const migrations = allMigrations();
    for (const capability of MODULES) expect(migrations).toContain(`'module:${capability.key}'`);
  });

  it('guards all platform child routes in the shared layout', () => {
    const layout = source('app/organizations/[organizationId]/platform/layout.tsx');
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
    ];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (/\.tsx?$/.test(entry.name)) files.push(path);
      }
    };
    walk(resolve(root, 'app/organizations/[organizationId]/platform'));
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
