import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPublicDb } from '@/lib/db/public';
import { logoUrl } from '@/lib/domain/branding/brand';
import { publishedHostnameSite } from '@/lib/domain/domains/resolve';
import { pageForSlug } from '@/lib/domain/public-site/paths';
import { SiteView } from './site-view';
import { PublicSiteCommunication } from '@/features/communications/public-site-communication';

/**
 * One page of a business's published website at its own hostname. The hostname is resolved again
 * here (D17) — a URL cannot name the business it shows — and the page is chosen from the one
 * published snapshot that read returned, so navigation, this page and every other page are always
 * the same revision. A path that names no published page is the canonical public 404, never a
 * fall-through into GildOps' own routes.
 *
 * A Portal hostname enters its dedicated /portal runtime. That runtime freshly verifies the
 * actual request hostname against PortalContext; a path parameter never supplies its authority.
 */

async function hosted(hostname: string) {
  return publishedHostnameSite(getPublicDb(), decodeURIComponent(hostname));
}

export async function hostedPageMetadata(hostname: string, slug: string | null): Promise<Metadata> {
  const found = await hosted(hostname);
  const page = found?.site ? pageForSlug(found.site.pages, slug) : null;
  if (!found?.site || !page) return { title: found?.profile.displayName };
  return {
    title: page.seoTitle,
    description: page.seoDescription,
    // A published website is meant to be found, unlike the transactional pages this group's layout
    // keeps out of search.
    robots: { index: true, follow: true },
  };
}

export async function HostedPage({ hostname, slug }: { hostname: string; slug: string | null }) {
  const found = await hosted(hostname);
  if (!found) notFound();

  if (found.surface === 'portal') {
    if (slug !== null) notFound();
    redirect('/portal');
  }

  // A business with nothing published has nothing to show at its address yet.
  const page = found.site ? pageForSlug(found.site.pages, slug) : null;
  if (!found.site || !page) notFound();
  const logoSrc = found.site.brand.logoPath ? logoUrl(getPublicDb(), found.site.brand.logoPath) : null;
  return <>
    <SiteView site={found.site} page={page} logoSrc={logoSrc} context={{ mode: 'live', forms: found.site.forms }} />
    <PublicSiteCommunication siteId={found.site.siteId} />
  </>;
}
