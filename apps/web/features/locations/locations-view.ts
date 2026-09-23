/**
 * Locations' two sibling representations of the one collection, as a URL value rather than
 * remembered state — the same reasoning Team's `?view=` and Schedule's own URL module rest on: a
 * view that survives a reload, arrives with the back button, and can be sent to somebody is a
 * fact the server can read, not a client component's memory. `list` is the bare route, so the
 * default view has one URL.
 */

export const LOCATIONS_VIEWS = ['list', 'map'] as const;

export type LocationsView = (typeof LOCATIONS_VIEWS)[number];

type QueryValue = string | readonly string[] | undefined;

/** Missing or unrecognised resolves to List — never a 404 for a mistyped query string. */
export function resolveLocationsView(raw: QueryValue): LocationsView {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === 'map' ? 'map' : 'list';
}

/** A Locations view's address. `list` carries no query string, so the default view has one URL. */
export function locationsViewHref(organizationId: string, view: LocationsView): string {
  const root = `/organizations/${organizationId}/locations`;
  return view === 'list' ? root : `${root}?view=${view}`;
}
