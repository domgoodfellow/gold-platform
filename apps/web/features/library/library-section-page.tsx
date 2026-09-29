import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { EmptyState } from '@/components/containers/section';
import { LibraryNav } from '@/features/library/library-nav';
import { libraryHref, type LibrarySectionKey } from '@/lib/route/library';
import { areaLabel } from '@/lib/navigation';

/**
 * The shared frame every Library section page renders: the crumb back to Library, the section
 * tab bar, a heading and an empty state. Storage, uploads, media processing, templates,
 * collections, knowledge indexing and external sources are later Library slices — this frame is
 * what each of those fills in, not a placeholder for them.
 */
export function LibrarySectionPage({
  organizationId,
  active,
  label,
  description,
  empty,
}: {
  organizationId: string;
  active: Exclude<LibrarySectionKey, 'home'>;
  label: string;
  description: string;
  empty: string;
}) {
  return (
    <AppPage>
      <PageHeader
        title={label}
        description={description}
        crumbs={[{ label: areaLabel('library'), href: libraryHref(organizationId, 'home') }]}
      />
      <LibraryNav organizationId={organizationId} active={active} />
      <EmptyState>{empty}</EmptyState>
    </AppPage>
  );
}
