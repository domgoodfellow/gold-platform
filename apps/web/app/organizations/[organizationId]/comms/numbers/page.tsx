import { AppPage } from '@/components/layout/app-page';
import { CollectionHeader } from '@/components/patterns/collection-header';
import { Hint } from '@/components/controls/inputs';
import { NumberList } from '@/features/communications/numbers/number-list';
import { listPhoneNumberAssignments, listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Numbers, a page of the Communications workspace. What a carrier knows about a number is a
 * provider resource, platform-scoped; this reads the organization-facing row it produced — what it
 * is used for, what it can do, whether it is ready, who is currently dialling from it.
 *
 * No acquisition or search here — that is provisioning, which belongs to GildOps and not to this
 * surface.
 */
export default async function CommsNumbersPage({
  params,
}: PageProps<'/organizations/[organizationId]/comms/numbers'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);

  const [numbers, assignments] = await Promise.all([
    listPhoneNumbers(db, { organizationId }),
    listPhoneNumberAssignments(db, { organizationId }),
  ]);

  const assignedCount = new Map<string, number>();
  for (const assignment of assignments) {
    assignedCount.set(assignment.phoneNumberId, (assignedCount.get(assignment.phoneNumberId) ?? 0) + 1);
  }

  return (
    <AppPage>
      <CollectionHeader
        title={areaLabel('comms-numbers')}
        crumbs={workspaceAncestry(organizationId, 'comms-numbers')}
      />
      <NumberList organizationId={organizationId} numbers={numbers} assignedCount={assignedCount} />
      <Hint className="mt-4">Numbers are added to a business by GildOps. What each is used for, and who dials from it, is set on its own page.</Hint>
    </AppPage>
  );
}
