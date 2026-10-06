import { PublicWebsiteSnapshotSchema, type PublicWebsiteSnapshot } from '@gold/schemas';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { PublicProfile } from '@/lib/domain/tenancy/profile';
import type { DomainSurface } from './domains';

/**
 * A Host header to the organization and surface it opens — the one place a hostname becomes an
 * organization (`public.hostname_binding`).
 *
 * **It selects, it never authorizes.** What it returns decides which published page a stranger is
 * shown, exactly as a slug in `/book/{slug}` does; RLS and every page's own guard still decide
 * anything else (D17). Unknown, unverified and released hostnames all answer `null`, one answer,
 * so nothing distinguishes an almost-valid name from a made-up one.
 */

export type HostnameBinding = { organizationId: string; surface: DomainSurface };

/** Lowercase, no port, no trailing dot; null for nothing usable. */
export function normalizeRequestHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const value = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.+$/, '');
  return /^[a-z0-9.-]{1,253}$/.test(value) ? value : null;
}

export async function resolveHostname(db: Db, host: string): Promise<HostnameBinding | null> {
  const hostname = normalizeRequestHost(host);
  if (!hostname) return null;
  const { data, error } = await db.rpc('hostname_binding', { p_hostname: hostname });
  if (error) throw new DomainError(error.message, 'domains.resolve_failed');
  const row = data?.[0];
  if (!row?.organization_id) return null;
  return { organizationId: row.organization_id, surface: row.surface as DomainSurface };
}

export type HostedSite = {
  surface: DomainSurface;
  profile: PublicProfile;
  /** The whole published website — every page and the navigation, at one revision — or null when the business has published none. Website surface only. */
  site: PublicWebsiteSnapshot | null;
};

/** What a resolved hostname renders, read in one step so the page never holds an id a URL supplied. */
export async function publishedHostnameSite(db: Db, host: string): Promise<HostedSite | null> {
  const hostname = normalizeRequestHost(host);
  if (!hostname) return null;
  const { data, error } = await db.rpc('published_hostname_site', { p_hostname: hostname });
  if (error) throw new DomainError(error.message, 'domains.resolve_failed');
  if (!data) return null;

  const raw = data as { surface: DomainSurface; profile: PublicProfile; site: unknown };
  let site: PublicWebsiteSnapshot | null = null;
  if (raw.site) {
    const parsed = PublicWebsiteSnapshotSchema.safeParse(raw.site);
    if (!parsed.success) {
      throw new DomainError('The published website does not match its supported schema.', 'public_site.invalid_projection');
    }
    site = parsed.data;
  }
  return { surface: raw.surface, profile: raw.profile, site };
}
