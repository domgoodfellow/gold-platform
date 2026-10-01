/**
 * Which connectors this deployment can actually connect a business to.
 *
 * **The only file that names a connector key in code** (I15, one axis over): the catalogue
 * (`platform_connectors`) says what exists and how it is described; this says what *runs*. A
 * connector an admin marks `live` before its adapter exists is browsable and honestly not
 * connectable, instead of a Connect button that does nothing (D31).
 *
 * A connector is a persistent relationship with an outside system, so every one runs a handshake.
 * A file is not a connector — see `lib/domain/files/`. An OAuth connector adds its key here in the
 * same change that adds its adapter in `apps/api/app/connectors/`.
 */

/**
 * Connectors `apps/api` can complete a sign-in for (D56). They are connectable only where this
 * deployment has an API to relay to; whether the API holds the vendor's client registration is the
 * API's own answer, given plainly when a person presses Connect.
 */
const NEEDS_API = new Set<string>(['google_workspace', 'microsoft_365', 'hubspot', 'notion', 'slack', 'dropbox', 'cloudflare']);

export function isConnectorImplemented(key: string): boolean {
  return NEEDS_API.has(key) && Boolean(process.env.GOLD_API_URL);
}

/** Whether connecting means a vendor's own sign-in rather than a direct record. */
export function usesSignIn(key: string): boolean {
  return NEEDS_API.has(key);
}
