import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { Hint } from '@/components/controls/inputs';
import { NumberList } from '@/features/communications/numbers/number-list';
import { listPhoneNumberAssignments, listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Numbers, a page of the Communications workspace. What a carrier knows about a number is a
 * provider resource, platform-scoped; this reads the organization-facing row it produced — the
 * lifecycle, the enabled directions, who is currently dialling from it.
 *
 * No acquisition or search here — that reaches into provisioning, out of scope for this slice.
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
      <PageHeader
        title={areaLabel('comms-numbers')}
        crumbs={workspaceAncestry(organizationId, 'comms-numbers')}
        description="The phone numbers this business has, and who is currently dialling from each one."
      />
      <NumberList organizationId={organizationId} numbers={numbers} assignedCount={assignedCount} />
      <Hint className="mt-4">Adding a number here is not available yet.</Hint>
    </AppPage>
  );
}
