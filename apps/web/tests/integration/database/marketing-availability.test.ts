import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OFFERINGS, type Availability } from '@/lib/marketing/content';

/**
 * The public site never says more about a product than GildOps' commercial catalogue does.
 *
 * Each offering in `lib/marketing/content.ts` names the catalogue features its description depends
 * on and states an availability. This derives the availability from those catalogue rows, as the
 * migrations seed them, and requires the two to agree. When the catalogue changes (a feature
 * becomes available, a product goes on sale), this fails until the site says the same.
 */

const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type CatalogueRow = {
  path: string;
  implementation_state: string;
  feature_lifecycle: string;
  feature_sale_status: string;
  product_lifecycle: string;
  product_sale_status: string;
};

/** `content.ts` explains the same rule in words; keep them together. */
function derive(rows: CatalogueRow[]): Availability {
  if (rows.length === 0) return 'not_yet';
  const offSale = (row: CatalogueRow) =>
    row.implementation_state === 'planned' ||
    row.feature_sale_status !== 'active' ||
    row.product_sale_status !== 'active' ||
    row.feature_lifecycle === 'deprecated' ||
    row.product_lifecycle === 'deprecated';
  if (rows.some(offSale)) return 'not_yet';
  const settling = (row: CatalogueRow) =>
    row.implementation_state !== 'available' || row.feature_lifecycle !== 'stable' || row.product_lifecycle !== 'stable';
  return rows.some(settling) ? 'testing' : 'available';
}

const pg = new Client({ connectionString: CONNECTION });
let catalogue: Map<string, CatalogueRow>;

describe('marketing availability follows the commercial catalogue', () => {
  beforeAll(async () => {
    await pg.connect();
    const { rows } = await pg.query<CatalogueRow>(
      `select p.key || '.' || m.key || '.' || f.key as path,
              f.implementation_state, f.lifecycle as feature_lifecycle, f.sale_status as feature_sale_status,
              p.lifecycle as product_lifecycle, p.sale_status as product_sale_status
         from public.platform_catalog_features f
         join public.platform_catalog_modules m on m.id = f.module_id
         join public.platform_catalog_products p on p.id = m.product_id`,
    );
    catalogue = new Map(rows.map((row) => [row.path, row]));
  });

  afterAll(async () => {
    await pg.end();
  });

  it('names only catalogue features that exist', () => {
    for (const offering of OFFERINGS) {
      for (const path of offering.catalogue) expect(catalogue.has(path), `${offering.id}: ${path}`).toBe(true);
    }
  });

  it.each(OFFERINGS.map((offering) => [offering.id, offering] as const))('%s says what the catalogue says', (_id, offering) => {
    const rows = offering.catalogue.map((path) => catalogue.get(path)!).filter(Boolean);
    expect(offering.availability).toBe(derive(rows));
  });
});
