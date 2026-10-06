import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { telephonyProviderKey } from '@/lib/adapters/telephony';
import { GENERIC_ACCOUNT_PROVIDER_KEYS } from '@/lib/route/provider-environment';

/**
 * Which providers can have a GildOps account configured is the API's fact — its registry is
 * `app.providers.providers.operations_for`. The web names the same set once, so the Providers list
 * can say "no account adapter" instead of drawing an *Add account* control nothing could use. Two
 * hand-kept lists drift; this holds them to each other, in both directions.
 *
 * A provider that is only *catalogued* — `elevenlabs`, `deepgram` — appears in neither.
 */

const REGISTRY = join(__dirname, '..', '..', '..', '..', 'api', 'app', 'providers', 'providers.py');

function apiAccountProviders(): string[] {
  const source = readFileSync(REGISTRY, 'utf8');
  const body = source.slice(source.indexOf('def operations_for('));
  return [...body.matchAll(/provider_key == "([a-z_]+)"/g)].map((match) => match[1]!).sort();
}

describe('the providers an account can be configured for', () => {
  it('finds the API registry, so the comparison is not passing over an empty list', () => {
    expect(apiAccountProviders().length).toBeGreaterThan(3);
  });

  it('is exactly the providers the API has operations for: telephony plus the generic account set', () => {
    const web = [...GENERIC_ACCOUNT_PROVIDER_KEYS, telephonyProviderKey()].sort();
    expect(web).toEqual(apiAccountProviders());
  });

  it('offers nothing to a provider that is only in the catalogue', () => {
    for (const key of ['elevenlabs', 'deepgram', 'supabase', 'openai_compatible']) {
      expect(GENERIC_ACCOUNT_PROVIDER_KEYS.has(key), key).toBe(false);
      expect(apiAccountProviders(), key).not.toContain(key);
    }
  });
});
