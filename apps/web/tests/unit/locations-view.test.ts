import { afterEach, describe, expect, it } from 'vitest';
import { locationsViewHref, resolveLocationsView } from '@/features/locations/locations-view';
import { mapConfig } from '@/lib/adapters/maps/config';

describe('resolveLocationsView', () => {
  it('resolves map explicitly and everything else — missing, invalid, or an array — to list', () => {
    expect(resolveLocationsView('map')).toBe('map');
    expect(resolveLocationsView('list')).toBe('list');
    expect(resolveLocationsView(undefined)).toBe('list');
    expect(resolveLocationsView('nonsense')).toBe('list');
    expect(resolveLocationsView(['map', 'list'])).toBe('map');
  });
});

describe('locationsViewHref', () => {
  it('gives list the bare route and map its own query string', () => {
    expect(locationsViewHref('org-1', 'list')).toBe('/organizations/org-1/locations');
    expect(locationsViewHref('org-1', 'map')).toBe('/organizations/org-1/locations?view=map');
  });
});

describe('mapConfig', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_MAP_STYLE_URL;

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_MAP_STYLE_URL;
    else process.env.NEXT_PUBLIC_MAP_STYLE_URL = ORIGINAL;
  });

  it('is null when the deployment has not configured a style', () => {
    delete process.env.NEXT_PUBLIC_MAP_STYLE_URL;
    expect(mapConfig()).toBeNull();
  });

  it('carries the configured style URL through verbatim, naming no provider', () => {
    process.env.NEXT_PUBLIC_MAP_STYLE_URL = 'https://example.test/style.json';
    expect(mapConfig()).toEqual({ styleUrl: 'https://example.test/style.json' });
  });
});
