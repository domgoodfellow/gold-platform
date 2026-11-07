import { afterEach, describe, expect, it, vi } from 'vitest';
import { e2eEnvironmentProblems, e2eTargetProblems } from '../../e2e/environment-guard';
import { e2eInstanceIdentity } from '@/lib/testing/e2e-instance';
import { developmentSupabaseTarget } from '@/lib/db/server';

const TOKEN = 'a'.repeat(40);
const local = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_DB_URL: 'postgresql://postgres:x@127.0.0.1:54322/postgres', E2E_INSTANCE_TOKEN: TOKEN };

describe('the browser runner refuses an unsafe environment before contacting any server', () => {
  it('allows a local database with an instance token', () => {
    expect(e2eEnvironmentProblems(local)).toEqual([]);
  });

  it('refuses a hosted database URL, a non-local app, any live provider secret and a missing token', () => {
    const problems = e2eEnvironmentProblems({
      SUPABASE_URL: 'https://project.supabase.co', E2E_BASE_URL: 'https://example.com', STRIPE_SECRET_KEY: 'sk_test_x',
    }).join('\n');
    expect(problems).toMatch(/SUPABASE_URL is not on this machine/);
    expect(problems).toMatch(/E2E_BASE_URL is not on this machine/);
    expect(problems).toMatch(/STRIPE_SECRET_KEY is set/);
    expect(problems).toMatch(/E2E_INSTANCE_TOKEN/);
  });

  it('treats a blank provider key as absent and refuses a short token', () => {
    expect(e2eEnvironmentProblems({ ...local, TWILIO_AUTH_TOKEN: '' })).toEqual([]);
    expect(e2eEnvironmentProblems({ ...local, E2E_INSTANCE_TOKEN: 'short' })).toHaveLength(1);
  });
});

describe('the target must prove it is the dedicated isolated instance', () => {
  it('refuses any server that does not answer the identity check, such as one started normally', () => {
    expect(e2eTargetProblems(local, 404, null)[0]).toMatch(/not the dedicated test instance/);
    expect(e2eTargetProblems(local, 0, null)[0]).toMatch(/not the dedicated test instance/);
  });

  it('refuses an instance using hosted or a different local Supabase, or holding provider secrets', () => {
    expect(e2eTargetProblems(local, 200, { supabaseUrl: 'https://project.supabase.co', providerSecrets: [] })[0]).toMatch(/not on this machine/);
    expect(e2eTargetProblems(local, 200, { supabaseUrl: 'http://127.0.0.1:59999', providerSecrets: [] })[0]).toMatch(/different local Supabase/);
    expect(e2eTargetProblems(local, 200, { supabaseUrl: local.SUPABASE_URL, providerSecrets: ['STRIPE_SECRET_KEY'] })[0]).toMatch(/STRIPE_SECRET_KEY/);
  });

  it('accepts the instance using this run’s local Supabase with no provider secrets', () => {
    expect(e2eTargetProblems(local, 200, { supabaseUrl: local.SUPABASE_URL, providerSecrets: [] })).toEqual([]);
  });
});

describe('a server reveals its identity only to the matching token and never in production', () => {
  const server = { E2E_INSTANCE_TOKEN: TOKEN, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NODE_ENV: 'development' };

  it('answers the matching token with its Supabase URL and provider secret names only', () => {
    expect(e2eInstanceIdentity({ ...server, STRIPE_SECRET_KEY: 'sk_x' }, TOKEN)).toEqual({ supabaseUrl: server.NEXT_PUBLIC_SUPABASE_URL, providerSecrets: ['STRIPE_SECRET_KEY'] });
  });

  it('is absent without a configured token, with a wrong or missing token, or in production', () => {
    expect(e2eInstanceIdentity({ ...server, E2E_INSTANCE_TOKEN: undefined }, TOKEN)).toBeNull();
    expect(e2eInstanceIdentity(server, 'b'.repeat(40))).toBeNull();
    expect(e2eInstanceIdentity(server, null)).toBeNull();
    expect(e2eInstanceIdentity({ ...server, NODE_ENV: 'production' }, TOKEN)).toBeNull();
  });
});

describe('a development server says which Supabase it is using', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is local only for a loopback Supabase under next dev', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    expect(developmentSupabaseTarget()).toBe('local');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321');
    expect(developmentSupabaseTarget()).toBe('local');
  });

  it('is hosted for any other address, and for a missing or unreadable one', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    expect(developmentSupabaseTarget()).toBe('hosted');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'not a url');
    expect(developmentSupabaseTarget()).toBe('hosted');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(developmentSupabaseTarget()).toBe('hosted');
  });

  it('says nothing outside next dev, so production and tests never draw the badge or demo sign-in', () => {
    for (const mode of ['production', 'test']) {
      vi.stubEnv('NODE_ENV', mode);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
      expect(developmentSupabaseTarget()).toBeNull();
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
      expect(developmentSupabaseTarget()).toBeNull();
    }
  });
});
