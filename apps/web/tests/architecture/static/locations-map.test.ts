import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Locations' deferred Map view, built: List and Map are URL-backed sibling representations of
 * one `Location[]`, the renderer stays a lazily-loaded client boundary the List path never pays
 * for, and coordinate truth keeps its existing confirmation workflow — a map never becomes a
 * second way to write one. Source guards, like `scheduling-workspace.test.ts` — nothing here
 * mounts a component or a real MapLibre instance.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const ROUTES = `${WEB}/app/organizations/[organizationId]`;
const LOCATIONS = `${WEB}/features/locations`;
const MAP = `${LOCATIONS}/map`;
const read = (path: string) => readFileSync(path, 'utf8');

describe('Locations is URL-backed List/Map, never client Tabs standing in for it', () => {
  it('locations-view.ts owns the two-view contract, feature-side', () => {
    expect(existsSync(`${LOCATIONS}/locations-view.ts`)).toBe(true);
    const contents = read(`${LOCATIONS}/locations-view.ts`);
    expect(contents).toContain("export const LOCATIONS_VIEWS = ['list', 'map']");
    expect(contents).toContain('export function resolveLocationsView(');
    expect(contents).toContain('export function locationsViewHref(');
  });

  it('LocationsViewNav composes the shared ViewNav, not a client Tabs primitive', () => {
    const nav = read(`${LOCATIONS}/locations-view-nav.tsx`);
    expect(nav).toContain('ViewNav');
    expect(nav).not.toContain("from '@gold/ui/components/tabs'");
    expect(nav).not.toContain("'use client'");
  });

  it('the route parses ?view= itself and composes LocationsViewNav', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    expect(page).toContain('resolveLocationsView(query.view)');
    expect(page).toContain('<LocationsViewNav');
  });
});

describe('the Locations route stays server-owned', () => {
  it('page.tsx is not a client component', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    expect(page).not.toContain("'use client'");
  });

  it('composes LocationTable for list and the map loader for map, one Location[] read feeding both', () => {
    const page = read(`${ROUTES}/locations/page.tsx`);
    expect(page.match(/listLocations\(db, \{ organizationId \}\)/g)).toHaveLength(1);
    expect(page).toContain('<LocationTable');
    expect(page).toContain('<LocationMapLoader');
    expect(page).toContain("view === 'list'");
  });
});

describe('LocationMapWorkspace lives feature-side, and its own map is a lazily-loaded client boundary', () => {
  it('the map package is feature-owned under features/locations/map', () => {
    for (const file of [
      'location-map-workspace.tsx',
      'location-map.tsx',
      'location-map-marker.ts',
      'location-map-panel.tsx',
      'location-map-loader.tsx',
      'location-search.ts',
    ]) {
      expect(existsSync(`${MAP}/${file}`), file).toBe(true);
    }
  });

  it('the loader dynamically imports the workspace with ssr disabled, from a client boundary', () => {
    const loader = read(`${MAP}/location-map-loader.tsx`);
    expect(loader).toContain("'use client'");
    expect(loader).toContain("dynamic(");
    expect(loader).toContain('ssr: false');
    expect(loader).toContain("import('./location-map-workspace')");
  });

  it('List presentation never imports the renderer or the loader', () => {
    const table = read(`${LOCATIONS}/location-table.tsx`);
    expect(table).not.toMatch(/maplibre|location-map/i);
  });

  it('only the renderer imports maplibre-gl; the workspace and search logic do not', () => {
    const mapModule = read(`${MAP}/location-map.tsx`);
    expect(mapModule).toContain("from 'maplibre-gl'");

    const workspace = read(`${MAP}/location-map-workspace.tsx`);
    expect(workspace).not.toContain("from 'maplibre-gl'");
    expect(workspace).not.toContain("maplibre-gl/dist");

    const search = read(`${MAP}/location-search.ts`);
    expect(search).not.toContain("from 'maplibre-gl'");
    expect(search).not.toContain("'use client'");
  });
});

describe('mapped vs unmapped: only confirmed coordinates become marker data, and every location stays in the semantic list', () => {
  const workspace = read(`${MAP}/location-map-workspace.tsx`);

  it('marker data is built only from locations with coordinates', () => {
    expect(workspace).toMatch(/mapped\s*=\s*useMemo\(\(\)\s*=>\s*filtered\.filter\(\(location\)\s*=>\s*location\.coordinates\s*!==\s*null\)/);
    expect(workspace).toContain('const markers: MapMarkerLocation[] = mapped.map(');
  });

  it('the rail renders the filtered set (mapped and unmapped alike), not the mapped-only set', () => {
    const railSection = workspace.slice(workspace.indexOf('<div className="flex flex-col gap-1 overflow-y-auto'));
    expect(railSection).toContain('filtered.map((location) => (');
    expect(railSection).toContain('<RailRow');
    expect(railSection).not.toContain('mapped.map(');
  });

  it('an unmapped row says so and offers the existing coordinate action, never a second geocoding workflow', () => {
    expect(workspace).toContain('Location not mapped');
    expect(workspace).toContain('LocationCoordinatesDrawer');
    expect(workspace).not.toContain('locateAddress');
    expect(workspace).not.toContain('geocodingProvider');
  });
});

describe('the map never becomes a second way to write coordinates', () => {
  it('LocationMap only reports a click back by id — it holds no Server Action, no coordinates write', () => {
    const mapModule = read(`${MAP}/location-map.tsx`);
    expect(mapModule).not.toContain('setLocationCoordinates');
    expect(mapModule).not.toContain("'use server'");
    expect(mapModule).not.toMatch(/locationCoordinatesAction|createLocationAction/);
  });

  it('no automatic geocoding runs when the map mounts or a marker is clicked', () => {
    for (const file of ['location-map.tsx', 'location-map-workspace.tsx', 'location-map-loader.tsx']) {
      const source = read(`${MAP}/${file}`);
      expect(source, file).not.toMatch(/locateAddress|geocodingProvider/);
    }
  });
});

describe('no hardcoded default city, and no public tile host treated as production truth', () => {
  it('the initial viewport is a neutral sentinel, not a named city’s coordinates', () => {
    const mapModule = read(`${MAP}/location-map.tsx`);
    expect(mapModule).toContain('center: [0, 0]');
    expect(mapModule).not.toMatch(/-73\.\d|45\.5\d|montr[eé]al/i);
  });

  it('the style/tile provider is an environment-configured URL, never a literal host', () => {
    const config = read(`${WEB}/lib/adapters/maps/config.ts`);
    expect(config).toContain('NEXT_PUBLIC_MAP_STYLE_URL');
    expect(config).not.toMatch(/https?:\/\//);

    const mapModule = read(`${MAP}/location-map.tsx`);
    expect(mapModule).not.toMatch(/https?:\/\/[^'"]*tile/i);
  });

  it('the Map pane explains an unconfigured deployment rather than falling back to a hardcoded style', () => {
    const workspace = read(`${MAP}/location-map-workspace.tsx`);
    expect(workspace).toContain('Maps aren’t available yet.');
  });
});

describe('no routing/tracking/clustering capability was added alongside the map', () => {
  it('adds no route-optimization, live-tracking, or clustering dependency or code', () => {
    const packageJson = read(`${WEB}/package.json`);
    expect(packageJson).not.toMatch(/mapbox-gl-directions|turf|supercluster|leaflet/i);

    for (const file of ['location-map.tsx', 'location-map-workspace.tsx']) {
      const source = read(`${MAP}/${file}`);
      expect(source, file).not.toMatch(/cluster|geofence|turn-by-turn|travel.?time|dispatch|live.?gps|service.?area/i);
    }
  });

  it('installs exactly one map renderer', () => {
    const packageJson = JSON.parse(read(`${WEB}/package.json`)) as { dependencies: Record<string, string> };
    const mapLibs = Object.keys(packageJson.dependencies).filter((name) => /maplibre|mapbox|leaflet|react-map-gl/i.test(name));
    expect(mapLibs).toEqual(['maplibre-gl']);
  });
});
