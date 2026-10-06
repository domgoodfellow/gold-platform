import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HostedPage, hostedPageMetadata } from '@/features/public-site/hosted-page';
import { isServablePageSlug } from '@/lib/domain/public-site/paths';

/**
 * Any other page of a business's published website, one path segment below the root. A segment
 * that could never name a page (a reserved platform path, anything malformed) is a 404 before the
 * database is asked; one that could is looked up in the one published snapshot.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: PageProps<'/sites/[hostname]/[slug]'>): Promise<Metadata> {
  const { hostname, slug } = await params;
  if (!isServablePageSlug(slug)) return {};
  return hostedPageMetadata(hostname, slug);
}

export default async function HostedSitePage({ params }: PageProps<'/sites/[hostname]/[slug]'>) {
  const { hostname, slug } = await params;
  if (!isServablePageSlug(slug)) notFound();
  return <HostedPage hostname={hostname} slug={slug} />;
}
