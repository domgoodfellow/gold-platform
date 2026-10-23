import { timingSafeEqual } from 'node:crypto';

/**
 * Lets the browser harness prove which server it is testing (apps/web/e2e/environment-guard.ts).
 * A server answers only when it was started with `E2E_INSTANCE_TOKEN`, the request presents that
 * same token, and it is not a production build. Every other server, including one started
 * normally from `apps/web/.env.local`, does not have this identity, so the harness refuses it.
 */
export const E2E_INSTANCE_HEADER = 'x-e2e-instance-token';

/**
 * Provider secrets a browser test target must not hold, recognized by name so that any provider is
 * caught, not only a listed one. Names only are reported, never values. The instance token itself
 * and Supabase's local keys (`*_ANON_KEY`, `*_ROLE_KEY`, `*_PUBLISHABLE_KEY`) do not match.
 */
const SECRET_NAME = /(_API_KEY|_API_KEY_SECRET|_SECRET|_SECRET_KEY|_AUTH_TOKEN|_OIDC_TOKEN)$/;

export function forbiddenSecretNames(env: Record<string, string | undefined>): string[] {
  return Object.keys(env).filter((name) => SECRET_NAME.test(name) && name !== 'E2E_INSTANCE_TOKEN' && Boolean(env[name])).sort();
}

export type E2eInstanceIdentity = {
  /** The Supabase host the server's own clients use. */
  supabaseUrl: string;
  /** Forbidden provider secrets the server holds (names only, never values). */
  providerSecrets: string[];
};

function sameToken(expected: string, presented: string | null): boolean {
  if (!presented) return false;
  const a = Buffer.from(expected), b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Null means "not this instance": the route then answers 404, indistinguishable from no route. */
export function e2eInstanceIdentity(env: Record<string, string | undefined>, presented: string | null): E2eInstanceIdentity | null {
  const token = env.E2E_INSTANCE_TOKEN;
  if (env.NODE_ENV === 'production' || !token || token.length < 32 || !sameToken(token, presented)) return null;
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    providerSecrets: forbiddenSecretNames(env),
  };
}
