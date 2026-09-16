import { Hint } from '@/components/controls/inputs';
import { EmptyState } from '@/components/containers/section';
import { requireOrganization } from '@/lib/route/organization';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listAutomationRules, listAutomationRuns } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { listMessageDeliveries, listMessageTemplates } from '@/lib/domain/automation/templates';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { AutomationRuleCard } from '@/features/automations/rules/rule-card';
import { CreateAutomationRuleForm } from '@/features/automations/rules/create-rule-form';
import { MessageTemplateSection } from '@/features/automations/templates/template-section';
import { RunLog } from '@/features/automations/activity/run-log';

export const dynamic = 'force-dynamic';

/** Rules this business writes: when something happens, if a job looks a certain way, do this. */
export default async function AutomationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/automations'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [rules, types, workFieldDefinitions, runs, templates, deliveries] = await Promise.all([
    listAutomationRules(db, { organizationId }),
    listWorkItemTypes(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listAutomationRuns(db, { organizationId, limit: 25 }),
    listMessageTemplates(db, { organizationId }),
    listMessageDeliveries(db, { organizationId, limit: 25 }),
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
  const statuses = everyStatus.map((status) => ({ id: status.id, label: status.label }));
  const warnings = await reviewAutomationRules(db, { organizationId, rules, statuses: everyStatus });
  const mayManage = organization.capabilities.includes('automation.manage');

  return (
    <>
      <Hint className="max-w-2xl">
        A rule watches for something happening, checks whether the job looks the way you
        describe, and then does something. Every condition has to hold — two rules is how you
        say &ldquo;or&rdquo;.
      </Hint>

      {rules.length === 0 ? (
        <EmptyState className="mt-6">
          No rules yet. Nothing happens on its own until this business says it should.
        </EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {rules.map((rule) => (
            <AutomationRuleCard
              key={rule.id}
              organizationId={organizationId}
              rule={rule}
              statuses={statuses}
              templates={templates}
              types={types}
              definitions={workFieldDefinitions}
              runs={runs.filter((run) => run.ruleId === rule.id).slice(0, 5)}
              warnings={warnings
                .filter((warning) => warning.ruleId === rule.id)
                .map((warning) => warning.message)}
              mayManage={mayManage}
            />
          ))}
        </div>
      )}

      {mayManage ? (
        <CreateAutomationRuleForm organizationId={organizationId} />
      ) : (
        <Hint className="mt-8">
          Your role, {organization.role}, cannot write rules here. You can see what they are
          and what they have done.
        </Hint>
      )}

      <MessageTemplateSection
        organizationId={organizationId}
        templates={templates}
        deliveries={deliveries}
        mayManage={mayManage}
        role={organization.role}
      />

      <RunLog runs={runs} />
    </>
  );
}
