import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { DividedList } from '@/components/containers/section';
import { FOCUS_RING } from '@/components/class-names';
import { LibraryNav } from '@/features/library/library-nav';
import { LIBRARY_SECTIONS, libraryHref } from '@/lib/route/library';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

const DESTINATION_STATE: Record<string, string> = {
  files: 'No files yet',
  media: 'No media yet',
  templates: 'No templates yet',
  knowledge: 'No knowledge sources yet',
  collections: 'No collections yet',
  sources: 'No connected sources yet',
  trash: 'Nothing archived',
};

/**
 * Library Home: the organization-wide shared-content registry a business has not populated yet.
 * Each destination states what it holds, once there is something to hold — not what a person
 * should do about it (ui-spec §8). No storage, upload or indexing exists behind any of these
 * yet; that is later Library slices, not this one.
 */
export default async function LibraryPage({
  params,
}: PageProps<'/organizations/[organizationId]/library'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);

  const destinations = LIBRARY_SECTIONS.filter((section) => section.key !== 'home');

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('library')}
        description="Files, media, templates and knowledge shared across this business's workspaces."
      />
      <LibraryNav organizationId={organizationId} active="home" />

      <DividedList className="border-y border-border">
        {destinations.map((section) => (
          <li key={section.key} className="relative flex items-center gap-4 py-3 transition-colors hover:bg-hover">
            <div className="min-w-0 flex-1">
              <Link
                href={libraryHref(organizationId, section.key)}
                className={`${FOCUS_RING} rounded font-medium after:absolute after:inset-0`}
              >
                {section.label}
              </Link>
              <p className="mt-0.5 text-sm text-muted">{DESTINATION_STATE[section.key]}</p>
            </div>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-subtle" />
          </li>
        ))}
      </DividedList>
    </AppPage>
  );
}
