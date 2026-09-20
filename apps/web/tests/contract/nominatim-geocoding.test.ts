import { afterEach, describe, expect, it, vi } from 'vitest';
import { geocodingProvider } from '@/lib/adapters/geocoding/registry';
import { nominatimGeocodingProvider } from '@/lib/adapters/geocoding/nominatim';

/**
 * The address-lookup adapter's contract with a public geocoder, offline. That service's usage
 * policy requires an identifying User-Agent, and a wrong answer here puts a job on the wrong map,
 * so both the request and the reading of the reply are pinned. `fetch` is replaced.
 */

const provider = nominatimGeocodingProvider({ contact: 'ops@gold.example' });

function stubFetch(reply: Response): { urls: string[]; headers: HeadersInit[] } {
  const seen = { urls: [] as string[], headers: [] as HeadersInit[] };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    seen.urls.push(String(url));
    seen.headers.push(init.headers ?? {});
    return reply;
  });
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('locating an address', () => {
  it('asks for one result, in the documented format, and identifies GOLD', async () => {
    const seen = stubFetch(new Response(JSON.stringify([{ lat: '52.37', lon: '4.89' }])));

    await provider.locate({ address: 'Keizersgracht 1, Amsterdam' });

    const url = new URL(seen.urls[0]);
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('q')).toBe('Keizersgracht 1, Amsterdam');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(seen.headers[0]).toMatchObject({ 'User-Agent': 'GOLD platform (ops@gold.example)' });
  });

  it('reads the first result as a numeric point', async () => {
    stubFetch(new Response(JSON.stringify([{ lat: '52.37', lon: '4.89' }, { lat: '1', lon: '1' }])));

    await expect(provider.locate({ address: 'x' })).resolves.toEqual({ latitude: 52.37, longitude: 4.89 });
  });

  it('says "not found" as null, which is an answer, and not as an error', async () => {
    stubFetch(new Response('[]'));

    await expect(provider.locate({ address: 'nowhere' })).resolves.toBeNull();
  });

  it('refuses a result that is not a point rather than mapping it', async () => {
    stubFetch(new Response(JSON.stringify([{ lat: 'north', lon: 'east' }])));

    await expect(provider.locate({ address: 'x' })).rejects.toThrow(/not a point/);
  });

  it('fails on a vendor error with its status', async () => {
    stubFetch(new Response('', { status: 429 }));

    await expect(provider.locate({ address: 'x' })).rejects.toThrow(/429/);
  });
});

describe('a deployment that has not configured it', () => {
  it('has no provider, so no address ever leaves for a third party unasked', async () => {
    vi.stubEnv('GEOCODING_CONTACT', '');

    await expect(geocodingProvider()).resolves.toBeNull();
  });
});
