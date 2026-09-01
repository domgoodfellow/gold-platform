import type { GeocodingProvider } from './index';

/**
 * Which implementation this deployment uses.
 *
 * The same shape as `adapters/payments/registry.ts`, deliberately: **the only file outside an
 * implementation that names a provider**, and `null` when nothing is configured rather than a
 * throw. A deployment with no geocoding is a complete deployment — coordinates are typed in by
 * hand, which is a slower answer and not a worse one.
 *
 * **What "configured" means here is a contact address, not a key**, and that is the provider's
 * requirement rather than ours: the service below is free and asks in return that every caller
 * identify itself so a misbehaving one can be reached. An installation that has not said who it
 * is has not finished configuring this, so the capability is absent — which is the same answer
 * the payment registry gives, arriving from a different direction.
 *
 * **Selection is by environment rather than by tenant.** Nothing about looking up an address is
 * a tenant's relationship with anybody: the platform asks on their behalf and stores two numbers
 * on their row. That is the opposite of D27's payment case, where the *tenant* holds the account
 * and the platform must never hold their money — and it is why this one needs no per-tenant
 * anything.
 */
export async function geocodingProvider(): Promise<GeocodingProvider | null> {
  const contact = process.env.GEOCODING_CONTACT;
  if (!contact) return null;

  const { nominatimGeocodingProvider } = await import('./nominatim');
  return nominatimGeocodingProvider({ contact });
}
