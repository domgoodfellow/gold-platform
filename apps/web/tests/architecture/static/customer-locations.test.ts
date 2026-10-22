import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CRM's own view onto the Location domain: a Customer's sites read through the same
 * `customer_locations` junction Locations itself reads, drawn with the same generic `LocationMap`
 * renderer — never a second map product, never a second query path for "which customer is this".
 * Source guards, like `locations-map.test.ts` and `scheduling-workspace.test.ts` — nothing here
 * mounts a component or a real MapLibre instance.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ROUTES = `${WEB}/app/organizations/[organizationId]`;
const CRM = `${WEB}/features/crm/customers`;
const LOCATIONS_LIB = `${WEB}/lib/domain/locations/locations.ts`;
const read = (path: string) => readFileSync(path, 'utf8');
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('a Customer reads its own sites through the Location domain, never a second one', () => {
  it('listLocationsForCustomer lives in the Location domain, not under crm/', () => {
    expect(read(LOCATIONS_LIB)).toContain('export async function listLocationsForCustomer(');
  });

  it('reuses the same customer_locations junction listLocations already reads, through one shared helper', () => {
    const locations = read(LOCATIONS_LIB);
    expect(locations.match(/async function attachCustomers\(/g)).toHaveLength(1);
    expect(locations).toContain("from('customer_locations')");
    // listLocations, getLocation and listLocationsForCustomer all delegate to it.
    expect(locations.match(/attachCustomers\(db, (input|organizationId)/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it('the customer route calls it once, feeding the record page', () => {
    const page = read(`${ROUTES}/crm/contacts/[contactId]/page.tsx`);
    expect(page).toContain('listLocationsForCustomer(db, { organizationId, customerId })');
  });
});

describe('the Customer-page map is the same generic renderer, lazily loaded, never a second map product', () => {
  it('every piece named for the widget exists, CRM-feature-owned', () => {
    for (const file of ['customer-locations-section.tsx', 'customer-location-map.tsx', 'customer-location-map-loader.tsx']) {
      expect(existsSync(`${CRM}/${file}`), file).toBe(true);
    }
  });

  it('CustomerLocationMap imports the generic LocationMap and LocationMapPanel rather than drawing its own canvas', () => {
    const widget = read(`${CRM}/customer-location-map.tsx`);
    expect(widget).toContain("from '@/features/locations/map/location-map'");
    expect(widget).toContain("from '@/features/locations/map/location-map-panel'");
    expect(widget).not.toContain("from 'maplibre-gl'");
  });

  it('only the loader is the client boundary that dynamically imports the renderer, ssr: false', () => {
    const loader = read(`${CRM}/customer-location-map-loader.tsx`);
    expect(loader).toContain("'use client'");
    expect(loader).toContain('dynamic(');
    expect(loader).toContain('ssr: false');
    expect(loader).toContain("import('./customer-location-map')");
  });

  it('the section composing them is a Server Component', () => {
    const section = read(`${CRM}/customer-locations-section.tsx`);
    expect(section).not.toContain("'use client'");
  });

  it('no coordinate-write or geocoding workflow is duplicated here — that stays on Locations', () => {
    for (const file of ['customer-location-map.tsx', 'customer-locations-section.tsx']) {
      const source = code(read(`${CRM}/${file}`));
      expect(source, file).not.toMatch(/setLocationCoordinates|locateAddress|geocodingProvider|LocationCoordinatesDrawer/);
    }
  });

  it('installs no second map renderer alongside the existing one', () => {
    const packageJson = JSON.parse(read(`${WEB}/package.json`)) as { dependencies: Record<string, string> };
    const mapLibs = Object.keys(packageJson.dependencies).filter((name) => /maplibre|mapbox|leaflet|react-map-gl/i.test(name));
    expect(mapLibs).toEqual(['maplibre-gl']);
  });
});

describe('"View all" expands into the canonical Locations workspace, with the customer still named', () => {
  it('the section links to /locations?customer={id}, never a bespoke customer-scoped route', () => {
    const section = read(`${CRM}/customer-locations-section.tsx`);
    expect(section).toContain('/locations?customer=${customerId}');
  });

  it('the Locations route reads ?customer= from the one Location[] it already loaded, not a second query', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    expect(page.match(/listLocations\(db, \{ organizationId \}\)/g)).toHaveLength(1);
    expect(page).toContain("query.customer === 'string'");
    expect(page).toContain('location.customers.some((customer) => customer.id === filterCustomerId)');
  });

  it('a customer-filtered view still offers a way back to every location', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    expect(page).toContain('Show all locations');
  });
});
