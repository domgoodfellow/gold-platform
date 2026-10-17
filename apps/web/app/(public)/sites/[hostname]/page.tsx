import type { Metadata } from 'next';
import { HostedPage, hostedPageMetadata } from '@/features/public-site/hosted-page';

/**
 * What a business's own hostname opens at its root: the homepage of its published website.
 * `proxy.ts` rewrites `/` on a resolved host here, carrying the **hostname** — never an
 * organization id — and `HostedPage` resolves it again for itself.
 *
 * Dynamic for the reason GildOps' own homepage is (`public-site-schema.test.ts`): the snapshot is
 * read from the database at request time, never at build time.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps<'/sites/[hostname]'>): Promise<Metadata> {
  const { hostname } = await params;
  return hostedPageMetadata(hostname, null);
}

export default async function HostedSiteHome({ params }: PageProps<'/sites/[hostname]'>) {
  const { hostname } = await params;
  return <HostedPage hostname={hostname} slug={null} />;
}
