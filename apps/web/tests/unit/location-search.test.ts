import { describe, expect, it } from 'vitest';
import { filterLocationsByQuery, matchesLocationQuery } from '@/features/locations/map/location-search';
import type { Location } from '@/lib/domain/locations/locations';

function location(overrides: Partial<Location> = {}): Location {
  return {
    id: 'loc-1',
    label: 'North depot',
    address: '1 Main Street',
    accessNotes: null,
    coordinates: null,
    custom: {},
    customers: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('matchesLocationQuery', () => {
  it('matches on label, address, and a served customer’s name', () => {
    const north = location({ label: 'North depot', address: '1 Main Street' });
    const warehouse = location({
      label: 'Client warehouse',
      address: '456 Industrial Rd',
      customers: [{ id: 'c1', name: 'Acme Ltd' }],
    });

    expect(matchesLocationQuery(north, 'north')).toBe(true);
    expect(matchesLocationQuery(north, 'main street')).toBe(true);
    expect(matchesLocationQuery(warehouse, 'acme')).toBe(true);
    expect(matchesLocationQuery(north, 'acme')).toBe(false);
  });

  it('is case-insensitive and trims the query', () => {
    const place = location({ label: 'North Depot' });
    expect(matchesLocationQuery(place, '  NORTH  ')).toBe(true);
  });

  it('matches everything for an empty or whitespace-only query', () => {
    const place = location();
    expect(matchesLocationQuery(place, '')).toBe(true);
    expect(matchesLocationQuery(place, '   ')).toBe(true);
  });
});

describe('filterLocationsByQuery', () => {
  it('returns every location for an empty query, in the given order', () => {
    const locations = [location({ id: 'a' }), location({ id: 'b' })];
    expect(filterLocationsByQuery(locations, '')).toEqual(locations);
  });

  it('narrows to only the matching locations', () => {
    const north = location({ id: 'a', label: 'North depot' });
    const south = location({ id: 'b', label: 'South yard' });
    expect(filterLocationsByQuery([north, south], 'south')).toEqual([south]);
  });
});
