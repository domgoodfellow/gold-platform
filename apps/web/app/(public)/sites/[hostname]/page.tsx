import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Hint } from '@/components/controls/inputs';
import { HomepageRenderer } from '@/features/public-site/homepage-renderer';
import { PublicHeader } from '@/features/public-profile/public-header';
import { getPublicDb } from '@/lib/db/public';
import { publishedHostnameSite } from '@/lib/domain/domains/resolve';

/**
 * What a business's own hostname opens at its root. `proxy.ts` rewrites `/` on a resolved host
 * here, carrying the **hostname** — never an organization id — and this page resolves it again for
 * itself (D17): a URL cannot name the business it shows.
 *
 * Dynamic for the reason GildOps' own homepage is (`public-site-schema.test.ts`): the projection is
 * read from the database at request time, never at build time.
 *
 * **The portal surface is a note, not a portal.** The portal is reached by the access link a
 * business sends (`/portal/{token}`); this slice gives a portal hostname the business's own header
 * and one sentence of application state, and builds no portal home.
 */
export const dynamic = 'force-dynamic';

async function site(hostname: string) {
  return publishedHostnameSite(getPublicDb(), decodeURIComponent(hostname));
}

export async function generateMetadata({ params }: PageProps<'/sites/[hostname]'>): Promise<Metadata> {
  const { hostname } = await params;
  const hosted = await site(hostname);
  if (!hosted?.home) return { title: hosted?.profile.displayName };
  return {
    title: hosted.home.seoTitle,
    description: hosted.home.seoDescription,
    // A published website is meant to be found, unlike the transactional pages this group's layout
    // keeps out of search.
    robots: { index: true, follow: true },
  };
}

export default async function HostedSitePage({ params }: PageProps<'/sites/[hostname]'>) {
  const { hostname } = await params;
  const hosted = await site(hostname);
  if (!hosted) notFound();

  if (hosted.surface === 'portal') {
    return (
      <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
        <PublicHeader profile={hosted.profile} />
        <Hint className="mt-8">Your history with this business opens from the access link it sent you.</Hint>
      </main>
    );
  }

  // A business with no published home page has nothing to show at its address yet.
  if (!hosted.home) notFound();
  return <HomepageRenderer sections={hosted.home.sections} forms={{ mode: 'live', forms: hosted.home.forms }} />;
}
