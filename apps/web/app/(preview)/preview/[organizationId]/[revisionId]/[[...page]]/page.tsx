import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ExperienceView } from '@/features/public-site/experience-view';
import { pageHref } from '@/features/public-site/site-view';
import { logoUrl } from '@/lib/domain/branding/brand';
import { pageForSlug } from '@/lib/domain/public-site/paths';
import { siteRevisionContext, sitePreview, type RevisionContext } from '@/lib/domain/public-site/public-site';
import { requireOrganization } from '@/lib/route/organization';
import { sourceRevision, sourceRevisionLabel } from '@/lib/source-revision';

export const dynamic = 'force-dynamic';

const STATUS: Record<RevisionContext['status'], string> = {
  draft: 'Draft', in_review: 'In review', published: 'Published', archived: 'Archived', discarded: 'Discarded',
};

/** Where this revision stands against the published one, in a few words. */
function standing(context: RevisionContext): string {
  const parts = [`Revision ${context.number}`, STATUS[context.status]];
  if (context.status !== 'published' && context.publishedRevisionNumber !== null) parts.push(`Revision ${context.publishedRevisionNumber} is published`);
  if (context.status !== 'published' && context.publishedRevisionNumber === null) parts.push('Nothing is published');
  if (context.stale) parts.push(`Started before revision ${context.publishedRevisionNumber}`);
  return parts.join(' · ');
}

/**
 * A private look at one revision of the whole website — published or not — through the same
 * experience renderer the public surfaces use (`ExperienceView`). The path below the revision is
 * the page's own, so a draft's navigation and its pages work before anything is published. Only
 * someone who may manage the website can see it, and nothing here is served to a stranger.
 *
 * The banner keeps three things apart: the content revision shown, where it stands against the
 * published one, and the build (source revision) whose renderer drew it.
 */
export default async function WebsitePreview({ params }: PageProps<'/preview/[organizationId]/[revisionId]/[[...page]]'>) {
  const { organizationId, revisionId, page: segments } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('organization.manage')) notFound();
  if (segments && segments.length > 1) notFound();

  const [site, context] = await Promise.all([
    sitePreview(db, { organizationId, revisionId }),
    siteRevisionContext(db, { organizationId, revisionId }),
  ]);
  const page = pageForSlug(site.pages, segments?.[0] ?? null);
  if (!page) notFound();

  const linkBase = `/preview/${organizationId}/${revisionId}`;
  const logoSrc = site.brand.logoPath ? logoUrl(db, site.brand.logoPath) : null;
  const marketing = context.experience === 'gildops_marketing';

  return (
    <ExperienceView
      experience={context.experience}
      site={site}
      page={page}
      logoSrc={logoSrc}
      linkBase={linkBase}
      standalone
      context={{ mode: 'preview', forms: site.forms }}
      banner={(
        <div data-preview-banner className="border-b border-border bg-surface px-4 py-2 text-center text-sm text-foreground">
          <strong>Private preview</strong>{' · '}{standing(context)}{' '}
          <Link className="underline underline-offset-4" href={`/organizations/${organizationId}/studio/website`}>Back to Website</Link>
          {marketing ? (
            <p className="mt-1 text-xs text-muted">
              {sourceRevisionLabel(sourceRevision())}
              {page.isHome ? '' : ' · Only the homepage of this site is served at the GildOps root'}
            </p>
          ) : null}
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
