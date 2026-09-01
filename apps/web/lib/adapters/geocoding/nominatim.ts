import type { Coordinates, GeocodingProvider } from './index';

/**
 * Nominatim, behind the capability its interface names.
 *
 * **One of two files in this repository that knows this service exists**, the other being the
 * registry that chooses it. Everything above asks where an address is; this is the one place
 * that knows how, and I15 is the test that keeps it so.
 *
 * **No SDK**, for the reason the payments adapter gives: what this needs is one HTTPS call and
 * a query string, both stable and specified.
 *
 * **The contact address is a term of use rather than a credential.** This service is free and
 * asks that every caller identify itself, so a deployment that has not said who it is does not
 * get the capability at all — see the registry. Nothing secret is held here.
 */

const API = 'https://nominatim.openstreetmap.org/search';

export function nominatimGeocodingProvider(config: { contact: string }): GeocodingProvider {
  return {
    name: 'OpenStreetMap',

    async locate(input): Promise<Coordinates | null> {
      const query = new URLSearchParams({
        q: input.address,
        format: 'jsonv2',
        // One answer. Choosing between several is a decision and belongs to the person looking
        // at the screen, not to this file — see the contract.
        limit: '1',
      });

      const response = await fetch(`${API}?${query.toString()}`, {
        headers: {
          // Their usage policy: identify the application and give somebody to contact. A
          // deployment with no contact address never reaches this file.
          'User-Agent': `GOLD platform (${config.contact})`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        // Distinct from "not found" on purpose: a refusal or an outage is not something a
        // business can fix by typing a better address, and the caller shows a different
        // sentence for each.
        throw new Error(`Geocoding failed with status ${response.status}.`);
      }

      const results = (await response.json()) as { lat?: string; lon?: string }[];
      const first = Array.isArray(results) ? results[0] : undefined;
      if (!first?.lat || !first?.lon) return null;

      const latitude = Number(first.lat);
      const longitude = Number(first.lon);
      // A malformed answer is a failure of this provider rather than an unrecognised address,
      // so it does not come back as null either.
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        throw new Error('Geocoding returned an answer that is not a point.');
      }

      return { latitude, longitude };
    },
  };
}
