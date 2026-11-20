import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { ApplyNavigationLayout } from '@/features/studio/interface/navigation-experiment';
import { NavigationExperimentView } from './navigation-experiment-view';
import { INTERFACE_DESIGN_CAPABILITY } from '@/lib/interface-design';
import { areaHref, workspaceLabel } from '@/lib/navigation';
import { readNavigationLayout } from '@/lib/route/navigation-layout';
import { requirePlatformArea } from '@/lib/route/platform';

export const dynamic = 'force-dynamic';

/**
 * Studio → Interface design → Navigation: GildOps staff compare the sidebar arrangements over the
 * real projection and apply one to their own session (ADR-056). The guard is the Platform one:
 * GildOps' operating organization, membership of it, and the interface-design permission read live
 * from the person's own staff row. Anybody else, including a business's owner, gets not-found.
 */
export default async function NavigationExperimentPage({ params }: PageProps<'/organizations/[organizationId]/studio/interface/navigation'>) {
  const { organizationId } = await params;
  const permissions = await requirePlatformArea(organizationId, INTERFACE_DESIGN_CAPABILITY);
  const applied = await readNavigationLayout(permissions);
  return (
    <AppPage>
      <CollectionHeader
        title="Navigation"
        crumbs={[{ label: workspaceLabel('studio'), href: areaHref(organizationId, 'studio') }, { label: 'Interface design' }]}
        actions={<ApplyNavigationLayout organizationId={organizationId} applied={applied} />}
      />
      <NavigationExperimentView organizationId={organizationId} applied={applied} />
    </AppPage>
  );
}
