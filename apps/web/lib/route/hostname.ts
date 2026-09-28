import { getPublicDb } from '@/lib/db/public';
import { normalizeRequestHost, resolveHostname, type HostnameBinding } from '@/lib/domain/domains/resolve';
import { siteUrl } from '@/lib/seo/site';

/**
 * Whether a request's Host is one of this deployment's own addresses, and if not, what it opens.
 *
 * **The deployment's own hosts come from its configuration, never from the request** — the same
 * rule `lib/seo/site.ts` states for canonicals: `SITE_URL` (or Vercel's production URL), the
 * deployment's own Vercel URLs, and a local development host. Those are never looked up, so the
 * application's own traffic costs no database call.
 *
 * **Everything else is resolved once and remembered briefly**, per server instance: a hostname
 * that resolves, and one that does not, are both kept for a minute. A newly verified domain is
 * therefore reachable within a minute on every instance, and a stranger cannot make every request
 * a database read by inventing Host headers.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
const REMEMBER_MS = 60_000;
const MAX_REMEMBERED = 1_000;

function configuredHosts(): Set<string> {
  const hosts = new Set<string>([siteUrl().hostname]);
  for (const value of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const host = normalizeRequestHost(value);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function isDeploymentHost(host: string): boolean {
  return LOCAL_HOSTS.has(host) || configuredHosts().has(host);
}

const remembered = new Map<string, { binding: HostnameBinding | null; until: number }>();

/**
 * The binding for a request's Host, or null for this deployment's own hosts and anything that
 * resolves to nothing. A resolution failure is also null: an unreachable database must not turn a
 * public request into an error page naming a hostname.
 */
export async function bindingForRequestHost(rawHost: string | null): Promise<HostnameBinding | null> {
  const host = normalizeRequestHost(rawHost);
  if (!host || isDeploymentHost(host)) return null;

  const now = Date.now();
  const cached = remembered.get(host);
  if (cached && cached.until > now) return cached.binding;

  let binding: HostnameBinding | null = null;
  try {
    binding = await resolveHostname(getPublicDb(), host);
  } catch {
    return null;
  }

  if (remembered.size >= MAX_REMEMBERED) remembered.clear();
  remembered.set(host, { binding, until: now + REMEMBER_MS });
  return binding;
}
