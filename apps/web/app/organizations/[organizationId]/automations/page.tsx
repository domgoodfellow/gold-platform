import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { requireOrganization } from '@/lib/route/organization';
import { listAutomationRules } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { areaHref, areaLabel } from '@/lib/navigation';
import { resolveAutomationsView } from '@/features/automations/workspace/views';
import { RulesTable } from '@/features/automations/rules/rules-table';
import { NewAutomationSheet } from '@/features/automations/rules/new-automation-sheet';

export const dynamic = 'force-dynamic';

/**
 * Rules, the first page of the Automations workspace. When something happens, if a job looks a
 * certain way, do this. Messages and Activity are the workspace's other pages and are routes of
 * their own (`automations/messages`, `automations/activity`); the sidebar is their one navigation,
 * so this page carries no tab strip over the same three. A rule is a complex entity and gets its own
 * detail route (`/automations/[ruleId]`); creating one, or adding a condition, action or message, is
 * bounded enough for a Sheet.
 *
 * The old `?view=messages` and `?view=activity` addresses still resolve, to the pages that replaced
 * them, so a bookmark or an email link is not a dead end.
 */
export default async function AutomationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const view = resolveAutomationsView(Array.isArray(query.view) ? query.view[0] : query.view);
  if (view === 'messages') redirect(areaHref(organizationId, 'automation-messages'));
  if (view === 'activity') redirect(areaHref(organizationId, 'automation-activity'));

  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('automation.manage');

  const [rules, types] = await Promise.all([
    listAutomationRules(db, { organizationId }),
    listWorkItemTypes(db, { organizationId }),
  ]);

  const everyStatus = (
    await Promise.all(
      types.map(async (type) => {
        const own = await listWorkItemStatuses(db, { organizationId, typeId: type.id });
        return own.map((status) => ({
          id: status.id,
          typeId: type.id,
          name: status.name,
          typeName: type.name,
          label: `${type.name} — ${status.name}`,
        }));
      }),
    )
  ).flat();

  const warnings = await reviewAutomationRules(db, { organizationId, rules, statuses: everyStatus });

  return (
    <>
      <PageHeader
        title={areaLabel('automations')}
        description="A rule watches for something happening, checks whether the job looks the way you describe, and then does something. Every condition has to hold — two rules is how you say “or”."
        actions={mayManage ? <NewAutomationSheet organizationId={organizationId} /> : null}
      />
      <RulesTable organizationId={organizationId} rules={rules} warnings={warnings} mayManage={mayManage} />
    </>
  );
}
