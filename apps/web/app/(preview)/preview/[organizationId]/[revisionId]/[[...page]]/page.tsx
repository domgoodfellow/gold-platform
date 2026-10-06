import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteView, pageHref } from '@/features/public-site/site-view';
import { logoUrl } from '@/lib/domain/branding/brand';
import { pageForSlug } from '@/lib/domain/public-site/paths';
import { sitePreview } from '@/lib/domain/public-site/public-site';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * A private look at one revision of the whole website — published or not — through the very view
 * the public hostname uses. The path below the revision is the page's own, so a draft's navigation
 * and its pages work before anything is published. Only someone who may manage the website can see
 * it, and nothing here is served to a stranger.
 */
export default async function WebsitePreview({ params }: PageProps<'/preview/[organizationId]/[revisionId]/[[...page]]'>) {
  const { organizationId, revisionId, page: segments } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('organization.manage')) notFound();
  if (segments && segments.length > 1) notFound();

  const site = await sitePreview(db, { organizationId, revisionId });
  const page = pageForSlug(site.pages, segments?.[0] ?? null);
  if (!page) notFound();

  const linkBase = `/preview/${organizationId}/${revisionId}`;
  const logoSrc = site.brand.logoPath ? logoUrl(db, site.brand.logoPath) : null;

  return (
    <SiteView
      site={site}
      page={page}
      logoSrc={logoSrc}
      linkBase={linkBase}
      context={{ mode: 'preview', forms: site.forms }}
      banner={(
        <div className="border-b border-border bg-surface px-4 py-2 text-center text-sm">
          <strong>Private preview · revision {site.revisionNumber}</strong>{' '}
          <Link className="underline underline-offset-4" href={`/organizations/${organizationId}/studio/website`}>Back to Website</Link>
          <nav aria-label="Pages in this revision" className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted">
            {site.pages.map((entry) => (
              <Link key={entry.id} href={pageHref(entry, linkBase)} aria-current={entry.id === page.id ? 'page' : undefined} className="underline-offset-4 hover:underline aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
                {entry.name}
              </Link>
            ))}
          </nav>
        </div>
      )}
    />
  );
}
