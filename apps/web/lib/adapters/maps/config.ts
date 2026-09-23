/**
 * The basemap this deployment renders against — a style document URL, never a vendor SDK or a
 * key. Separate from geocoding (`lib/adapters/geocoding`), on purpose: geocoding turns an
 * address into coordinates, server-side, once, at the moment somebody looks one up; this turns
 * already-stored coordinates into a picture in a browser, every time somebody opens the Map
 * view. Nothing here names a provider — `styleUrl` could point at MapLibre's own demo tiles, a
 * self-hosted style, or a commercial style/tile service, and the renderer neither knows nor
 * cares which.
 */
export type MapConfig = {
  styleUrl: string;
};

/**
 * Null when unconfigured. A style URL intended for browser rendering is not a secret — it is
 * read from `NEXT_PUBLIC_MAP_STYLE_URL`, the same "browser-visible, not sensitive" shape
 * `NEXT_PUBLIC_SUPABASE_URL` already has — but an unset one must not fall back to a public tile
 * host standing in as this deployment's production infrastructure. The Map view reads this null
 * as "not configured" and says so; List stays fully usable either way.
 */
export function mapConfig(): MapConfig | null {
  const styleUrl = process.env.NEXT_PUBLIC_MAP_STYLE_URL;
  return styleUrl ? { styleUrl } : null;
}
