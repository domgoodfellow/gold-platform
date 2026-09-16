import { Hint } from '@/components/controls/inputs';
import { requireOrganization } from '@/lib/route/organization';
import { listAutomationRules, listAutomationRuns } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { listMessageDeliveries, listMessageTemplates } from '@/lib/domain/automation/templates';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { AutomationsViewTabs } from '@/features/automations/workspace/view-tabs';
import { resolveAutomationsView } from '@/features/automations/workspace/views';
import { RulesTable } from '@/features/automations/rules/rules-table';
import { NewAutomationSheet } from '@/features/automations/rules/new-automation-sheet';
import { MessagesView } from '@/features/automations/templates/messages-view';
import { ActivityView } from '@/features/automations/activity/activity-view';

export const dynamic = 'force-dynamic';

/**
 * The Automations workspace. Rules this business writes: when something happens, if a job looks
 * a certain way, do this. Three URL-backed sibling views — Rules, Messages, Activity — rather
 * than one page opening every rule as a complete editor at once, which is what stopped scaling
 * past a handful. A rule is a complex entity and gets its own detail route
 * (`/automations/[ruleId]`); creating one, or adding a condition, action or message, is bounded
 * enough for a Sheet.
 */
export default async function AutomationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const rawView = Array.isArray(query.view) ? query.view[0] : query.view;
  const view = resolveAutomationsView(rawView);

  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('automation.manage');

  const templates = await listMessageTemplates(db, { organizationId });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AutomationsViewTabs view={view} messageCount={templates.length} />
        {view === 'rules' && mayManage ? (
          <NewAutomationSheet organizationId={organizationId} />
        ) : null}
      </div>

      {view === 'rules' ? (
        <RulesView organizationId={organizationId} mayManage={mayManage} />
      ) : null}

      {view === 'messages' ? (
        <MessagesView
          organizationId={organizationId}
          templates={templates}
          mayManage={mayManage}
          role={organization.role}
        />
      ) : null}

      {view === 'activity' ? <AutomationsActivityView organizationId={organizationId} /> : null}
    </>
  );
}

async function RulesView({
  organizationId,
  mayManage,
}: {
  organizationId: string;
  mayManage: boolean;
}) {
  const { db } = await requireOrganization(organizationId);

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
      <Hint className="mt-6 max-w-2xl">
        A rule watches for something happening, checks whether the job looks the way you
        describe, and then does something. Every condition has to hold — two rules is how you
        say &ldquo;or&rdquo;.
      </Hint>
      <RulesTable organizationId={organizationId} rules={rules} warnings={warnings} mayManage={mayManage} />
    </>
  );
}

async function AutomationsActivityView({ organizationId }: { organizationId: string }) {
  const { db } = await requireOrganization(organizationId);

  const [runs, deliveries] = await Promise.all([
    listAutomationRuns(db, { organizationId, limit: 50 }),
    listMessageDeliveries(db, { organizationId, limit: 50 }),
  ]);

  return <ActivityView runs={runs} deliveries={deliveries} />;
}
