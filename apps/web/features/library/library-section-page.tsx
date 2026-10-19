import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { EmptyState } from '@/components/surfaces/section';
import { libraryHref } from '@/lib/route/library';
import { areaLabel } from '@/lib/navigation';

/**
 * The shared frame every Library section page renders: the crumb back to Library and a major empty
 * state — every one of these destinations is genuinely empty today, so `description` explains what
 * the destination is *for* beside the state that says it holds nothing yet, rather than as a
 * `PageHeader` sentence nobody reads before an empty page. Moving between sections is the Library
 * popover's job, not a tab bar on the page. Storage, uploads, media processing, templates, collections,
 * knowledge indexing and external sources are later Library slices — this frame is what each of those fills in.
 */
export function LibrarySectionPage({
  organizationId,
  label,
  description,
  empty,
}: {
  organizationId: string;
  label: string;
  description: string;
  empty: string;
}) {
  return (
    <AppPage>
      <CollectionHeader title={label} crumbs={[{ label: areaLabel('library'), href: libraryHref(organizationId, 'files') }]} />
      <EmptyState title={empty} description={description} />
    </AppPage>
  );
}
