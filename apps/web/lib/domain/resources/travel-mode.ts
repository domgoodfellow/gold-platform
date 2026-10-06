/**
 * How a resource moves — the business's statement, not a consequence of what kind of thing it is.
 * A vehicle is usually mobile and a bay usually fixed, and neither is assumed: an unstated mode
 * (null on the row) means travel is simply not evaluated for that resource.
 */
export const TRAVEL_MODES = ['mobile', 'fixed'] as const;

export type TravelMode = (typeof TRAVEL_MODES)[number];

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  mobile: 'Travels to the work',
  fixed: 'Stays at its base',
};

export function isTravelMode(value: unknown): value is TravelMode {
  return typeof value === 'string' && (TRAVEL_MODES as readonly string[]).includes(value);
}
