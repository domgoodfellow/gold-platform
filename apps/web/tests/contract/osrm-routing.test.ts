import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutingError } from '@/lib/adapters/routing';
import { osrmRoutingProvider } from '@/lib/adapters/routing/osrm';
import { routingProvider } from '@/lib/adapters/routing/registry';

/**
 * The routing adapter's contract with a router, offline. The order of the two numbers in a
 * coordinate is the classic way to put every job in the wrong hemisphere, a refusal about the
 * question must not be mistaken for an outage, and nothing a vendor says may reach a screen — so the
 * request, the reading of the reply and the sorting of refusals are each pinned. `fetch` is replaced.
 */

const provider = osrmRoutingProvider({ baseUrl: 'https://router.example/' });
const AMSTERDAM = { latitude: 52.37, longitude: 4.89 };
const UTRECHT = { latitude: 52.09, longitude: 5.12 };

function stubFetch(reply: Response | Error): { urls: string[] } {
  const seen = { urls: [] as string[] };
  vi.stubGlobal('fetch', async (url: string) => {
    seen.urls.push(String(url));
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return seen;
}

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof RoutingError) return error.failure;
    throw error;
  }
  throw new Error('expected a refusal');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('asking for a trip', () => {
  it('sends longitude first, for driving, without a geometry nobody reads', async () => {
    const seen = stubFetch(ok({ code: 'Ok', routes: [{ duration: 1500, distance: 43000 }] }));

    await provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' });

    const url = new URL(seen.urls[0]);
    expect(url.origin).toBe('https://router.example');
    expect(url.pathname).toBe('/route/v1/driving/4.89,52.37;5.12,52.09');
    expect(url.searchParams.get('overview')).toBe('false');
  });

  it('reads the first route as whole seconds and metres, and says who answered', async () => {
    stubFetch(ok({ code: 'Ok', routes: [{ duration: 1499.2, distance: 42999.6 }, { duration: 1, distance: 1 }] }));

    const result = await provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' });

    // A duration is rounded up: promising a minute that is not there is the dangerous way to be wrong.
    expect(result).toMatchObject({ durationSeconds: 1500, distanceMeters: 43000, provider: 'osrm' });
    expect(Number.isNaN(Date.parse(result.calculatedAt))).toBe(false);
  });
});

describe('what goes wrong, in a closed set', () => {
  it('says "no drivable route" as an answer about the pair', async () => {
    stubFetch(ok({ code: 'NoRoute' }, 400));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('route_not_found');
  });

  it('says a refused coordinate is invalid, without asking when it plainly is', async () => {
    const seen = stubFetch(ok({ code: 'InvalidQuery' }, 400));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('invalid_coordinates');

    const none = stubFetch(ok({}));
    expect(await refusal(provider.route({ origin: { latitude: 95, longitude: 0 }, destination: UTRECHT, mode: 'driving' }))).toBe('invalid_coordinates');
    expect(none.urls).toEqual([]);
    expect(seen.urls).toHaveLength(1);
  });

  it('says a rate limit is a rate limit', async () => {
    stubFetch(new Response('slow down', { status: 429 }));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('quota_exceeded');
  });

  it('says a server error, an unreachable service and a timeout are all an outage', async () => {
    stubFetch(new Response('boom', { status: 503 }));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('provider_unavailable');

    stubFetch(new TypeError('fetch failed'));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('provider_unavailable');

    stubFetch(new DOMException('timed out', 'TimeoutError'));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('provider_unavailable');
  });

  it('treats an answer that is not a trip as the service’s failure, never as "no route"', async () => {
    stubFetch(ok({ code: 'Ok', routes: [{ duration: 'soon', distance: 1 }] }));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('provider_unavailable');

    stubFetch(ok({ code: 'Ok', routes: [] }));
    expect(await refusal(provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' }))).toBe('provider_unavailable');
  });

  it('does not let a vendor’s own words through', async () => {
    stubFetch(ok({ code: 'NoRoute', message: 'OSRM internal detail 0xDEAD' }, 400));
    try {
      await provider.route({ origin: AMSTERDAM, destination: UTRECHT, mode: 'driving' });
    } catch (error) {
      expect((error as Error).message).not.toMatch(/0xDEAD/);
    }
  });
});

describe('which router this deployment has', () => {
  it('is none until a deployment says where one is', async () => {
    vi.stubEnv('ROUTING_BASE_URL', '');
    expect(await routingProvider()).toBeNull();
  });

  it('is the configured one, without a key for this runtime to hold', async () => {
    vi.stubEnv('ROUTING_BASE_URL', 'https://router.example');
    expect((await routingProvider())?.name).toBe('osrm');
  });
});
