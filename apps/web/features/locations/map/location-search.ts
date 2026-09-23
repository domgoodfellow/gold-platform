import type { Location } from '@/lib/domain/locations/locations';

/**
 * Whether a location's own presentation fields — its label, address, or a customer it serves —
 * mention `query`. Pure, and deliberately free of anything the map renderer touches (no
 * `maplibre-gl` import reaches this file), so the search behaviour underneath the workspace is
 * testable without a browser.
 */
export function matchesLocationQuery(location: Location, query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const haystack = [location.label, location.address, ...location.customers.map((customer) => customer.name)]
    .join(' ')
    .toLowerCase();
  return haystack.includes(trimmed.toLowerCase());
}

/** Empty query returns every location, in its given order — no server round trip for this first slice. */
export function filterLocationsByQuery(locations: Location[], query: string): Location[] {
  return locations.filter((location) => matchesLocationQuery(location, query));
}
