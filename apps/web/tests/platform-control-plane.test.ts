import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULES } from '@/lib/navigation';

const root = resolve(import.meta.dirname, '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('platform control-plane scope boundaries', () => {
  it('owns global rates in Pricing without an organization id', () => {
    const page = source('app/(platform)/platform/pricing/page.tsx');
    expect(page).toContain('listProviderRates(db)');
    expect(page).toContain('listRetailRates(db)');
    expect(page).not.toContain('organizationId');
    expect(source('features/platform/pricing/rate-forms.tsx')).not.toContain('organizationId');
  });

  it('keeps tenant commercial and provider tasks in their tenant routes', () => {
    const commercial = source('app/(platform)/platform/organizations/[organizationId]/commercial/page.tsx');
    const providers = source('app/(platform)/platform/organizations/[organizationId]/providers/page.tsx');
    expect(commercial).toContain('listOrganizationTerms');
    expect(commercial).not.toContain('RecordProviderRateForm');
    expect(commercial).not.toContain('RecordRetailRateForm');
    expect(providers).toContain('listProviderBindings');
    expect(providers).toContain('listProviderResources');
  });

  it('maps every code-backed module to a commercial product key', () => {
    const migration = source('../../supabase/migrations/20260910000001_gold_sells_gold_the_commercial_catalogue.sql');
    for (const capability of MODULES) expect(migration).toContain(`'module:${capability.key}'`);
  });

  it('guards all platform child routes in the shared layout', () => {
    const layout = source('app/(platform)/platform/layout.tsx');
    expect(layout).toContain('requireActor(db)');
    expect(layout).toContain('isPlatformStaff(db)');
    expect(layout).toContain("redirect('/organizations')");
  });
});
