import { RoutingError, type Coordinates, type RouteRequest, type RouteResult, type RoutingProvider } from './index';

/**
 * The Open Source Routing Machine's HTTP API, behind the capability its interface names — one of two
 * files that knows this vendor exists. No SDK: one HTTPS call. The service is self-hostable,
 * which is why a deployment can run one without a key; it has no traffic model, so `departureAt` is
 * ignored and the answer is the ordinary driving duration.
 */

/** A slow router must not hold a slot page open; a timeout is an outage, not an answer. */
const TIMEOUT_MS = 4000;

function validPoint(point: Coordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/** The service takes longitude first, and nothing here should ever have to remember that. */
function path(origin: Coordinates, destination: Coordinates): string {
  return `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
}

export function osrmRoutingProvider(config: { baseUrl: string }): RoutingProvider {
  const base = config.baseUrl.replace(/\/+$/, '');

  return {
    name: 'osrm',

    async route(request: RouteRequest): Promise<RouteResult> {
      if (!validPoint(request.origin) || !validPoint(request.destination)) {
        throw new RoutingError('invalid_coordinates', 'A point for routing is not a valid coordinate.');
      }

      let response: Response;
      try {
        response = await fetch(`${base}/route/v1/driving/${path(request.origin, request.destination)}?overview=false`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // Unreachable, refused or timed out: the same fact for a caller — nothing was learned.
        throw new RoutingError('provider_unavailable', 'The routing service could not be reached.');
      }

      type Body = { code?: string; routes?: { duration?: number; distance?: number }[] };
      let body: Body | null;
      try {
        body = (await response.json()) as Body;
      } catch {
        body = null;
      }

      // The service answers a refusal about the *question* with a 4xx and a code in the body, so the
      // body is read before the status is trusted.
      if (body?.code === 'NoRoute' || body?.code === 'NoSegment') {
        throw new RoutingError('route_not_found', 'There is no drivable route between those points.');
      }
      if (body?.code === 'InvalidQuery' || body?.code === 'InvalidValue') {
        throw new RoutingError('invalid_coordinates', 'The routing service refused those coordinates.');
      }
      if (response.status === 429) {
        throw new RoutingError('quota_exceeded', 'The routing service is busy. Try again in a moment.');
      }
      if (!response.ok || body?.code !== 'Ok') {
        throw new RoutingError('provider_unavailable', `The routing service failed with status ${response.status}.`);
      }

      const first = body.routes?.[0];
      const durationSeconds = Number(first?.duration);
      const distanceMeters = Number(first?.distance);
      // A reply that is not a trip is the service's failure, not "no route" — nobody typed anything better.
      if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters) || durationSeconds < 0 || distanceMeters < 0) {
        throw new RoutingError('provider_unavailable', 'The routing service returned an answer that is not a trip.');
      }

      return {
        distanceMeters: Math.round(distanceMeters),
        durationSeconds: Math.ceil(durationSeconds),
        provider: 'osrm',
        calculatedAt: new Date().toISOString(),
      };
    },
  };
}
