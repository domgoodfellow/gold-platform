import type { Coordinates } from '@/lib/adapters/geocoding';

/**
 * How long it takes to drive from one stored point to another, named as a capability rather than a
 * provider. No type here may carry a provider's response shape, a route geometry, a turn list
 * or a vendor's error code — a duration and a distance come back, or a categorised refusal does.
 *
 * Scheduling asks this to know whether a resource can get from one job to the next. It is not the
 * map (`lib/adapters/maps` only draws stored points) and it is not the geocoder (that turns an
 * address into the points this takes).
 */

export type { Coordinates };

export type RouteRequest = {
  origin: Coordinates;
  destination: Coordinates;
  /**
   * When the trip would start. A hint: an implementation that has no traffic model ignores it, and
   * the answer is then the ordinary duration. Scheduling never depends on it being honoured.
   */
  departureAt?: string;
  mode: 'driving';
};

export type RouteResult = {
  distanceMeters: number;
  durationSeconds: number;
  /** Present only when the implementation has a traffic model and used it. Scheduling does not read it yet. */
  trafficDurationSeconds?: number;
  /** What answered, for debugging and provenance — never shown to a tenant as a vendor. */
  provider: string;
  calculatedAt: string;
};

/** The closed set a refusal is normalised into, so no vendor's error code reaches a screen. */
export type RoutingFailure = 'route_not_found' | 'provider_unavailable' | 'invalid_coordinates' | 'quota_exceeded';

export class RoutingError extends Error {
  constructor(
    readonly failure: RoutingFailure,
    message: string,
  ) {
    super(message);
    this.name = 'RoutingError';
  }
}

export type RoutingProvider = {
  readonly name: string;
  /**
   * One trip. Throws `RoutingError` — `route_not_found` for two valid points with no drivable way
   * between them (an answer about the world), the others for the provider or the input (an answer
   * about the call). One attempt, bounded in time: callers decide whether trying again is worth it.
   */
  route(request: RouteRequest): Promise<RouteResult>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { routingProvider } from './registry';
