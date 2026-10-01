import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { EmptyState } from '@/components/surfaces/section';
import { LibraryNav } from '@/features/library/library-nav';
import { libraryHref, type LibrarySectionKey } from '@/lib/route/library';
import { areaLabel } from '@/lib/navigation';

/**
 * The shared frame every Library section page renders: the crumb back to Library, the section
 * tab bar, and a major empty state — every one of these destinations is genuinely empty today, so
 * `description` explains what the destination is *for* beside the state that says it holds
 * nothing yet, rather than as a `PageHeader` sentence nobody reads before an empty page. Storage,
 * uploads, media processing, templates, collections, knowledge indexing and external sources are
 * later Library slices — this frame is what each of those fills in, not a placeholder for them.
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
      <CollectionHeader title={label} crumbs={[{ label: areaLabel('library'), href: libraryHref(organizationId, 'home') }]} />
      <LibraryNav organizationId={organizationId} active={active} />
      <EmptyState title={empty} description={description} />
    </AppPage>
  );
}
