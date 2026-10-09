import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Hint } from '@/components/controls/inputs';
import { PublicHeader } from '@/features/public-profile/public-header';
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
 * **The portal surface is a note, not a portal.** The portal is reached by the access link a
 * business sends (`/portal/{token}`); a portal hostname gets the business's own header and one
 * sentence of application state at its root, and nothing at any other path.
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
    return (
      <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
        <PublicHeader profile={found.profile} />
        <Hint className="mt-8">Your history with this business opens from the access link it sent you.</Hint>
      </main>
    );
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
