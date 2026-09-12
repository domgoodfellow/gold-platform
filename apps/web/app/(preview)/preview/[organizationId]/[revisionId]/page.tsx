import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BrandStyle } from '@/features/branding/brand-style';
import { HomepageRenderer } from '@/features/public-site/homepage-renderer';
import { homepagePreview } from '@/lib/domain/public-site/public-site';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function WebsitePreview({ params }: PageProps<'/preview/[organizationId]/[revisionId]'>) {
  const { organizationId, revisionId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('organization.manage')) notFound();
  const site = await homepagePreview(db, { organizationId, revisionId });
  return <div data-brand><BrandStyle brand={site.brand} /><div className="border-b border-border bg-surface px-4 py-2 text-center text-sm"><strong>Private preview · revision {site.revisionNumber}</strong>{' '}<Link className="underline underline-offset-4" href={`/organizations/${organizationId}/settings/website`}>Back to Website</Link></div><main className="mx-auto w-full max-w-5xl p-6 sm:p-8"><HomepageRenderer sections={site.sections} /></main></div>;
}
