import type { Coordinates, GeocodingProvider } from './index';

/** Nominatim, behind the capability its interface names — one of two files that knows this vendor exists (I15). No SDK: one HTTPS call and a query string. */

const API = 'https://nominatim.openstreetmap.org/search';

export function nominatimGeocodingProvider(config: { contact: string }): GeocodingProvider {
  return {
    name: 'OpenStreetMap',

    async locate(input): Promise<Coordinates | null> {
      const query = new URLSearchParams({
        q: input.address,
        format: 'jsonv2',
        limit: '1',
      });

      const response = await fetch(`${API}?${query.toString()}`, {
        headers: {
          // Their usage policy requires identifying the caller — a deployment with no contact never reaches this file.
          'User-Agent': `GOLD platform (${config.contact})`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        // Distinct from "not found" — an outage isn't fixable by typing a better address.
        throw new Error(`Geocoding failed with status ${response.status}.`);
      }

      const results = (await response.json()) as { lat?: string; lon?: string }[];
      const first = Array.isArray(results) ? results[0] : undefined;
      if (!first?.lat || !first?.lon) return null;

      const latitude = Number(first.lat);
      const longitude = Number(first.lon);
      // A malformed answer is this provider's failure, not an unrecognised address — so it throws rather than returning null.
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Geocoding returned an answer that is not a point.');
      }

      return { latitude, longitude };
    },
  };
}
