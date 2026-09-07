import type { GeocodingProvider } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. Null when unconfigured: coordinates are typed in by hand, which is slower, not
 * incomplete. "Configured" means a contact address (Nominatim's usage policy), not a key.
 * Selected by environment, not by tenant — the platform is looking up the address on its behalf.
 */
export async function geocodingProvider(): Promise<GeocodingProvider | null> {
  const contact = process.env.GEOCODING_CONTACT;
  if (!contact) return null;

  const { nominatimGeocodingProvider } = await import('./nominatim');
  return nominatimGeocodingProvider({ contact });
}
