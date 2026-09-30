import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/headers/page-header';
import { GroupHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { areaHref, areaLabel, workspaceAncestry } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listAutomationRules, listAutomationRuns } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { listMessageTemplates } from '@/lib/domain/automation/templates';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { RuleHeading } from '@/features/automations/rules/rule-heading';
import { ConditionList } from '@/features/automations/rules/condition-list';
import { ActionList } from '@/features/automations/rules/action-list';
import { describeTrigger } from '@/features/automations/rules/trigger';
import { RuleWarnings } from '@/features/automations/review/rule-warnings';
import { RuleActivity } from '@/features/automations/activity/rule-activity';

export const dynamic = 'force-dynamic';

/**
 * A rule's own record — WHEN this occurs, IF these conditions hold, THEN perform these actions,
 * read top to bottom as the sentence it is. The trigger is read-only (the domain layer refuses to
 * change it after creation); conditions and actions support add/remove only, each behind its own
 * Sheet, because the domain layer supports no update to either.
 */
export default async function AutomationRulePage({
  params,
}: PageProps<'/organizations/[organizationId]/automations/[ruleId]'>) {
  const { organizationId, ruleId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's rule id resolves to nothing here, so this 404s rather than rendering empty —
  // the same indistinguishability RLS already gives `getResource` and its siblings.
  const rules = await listAutomationRules(db, { organizationId });
  const rule = rules.find((entry) => entry.id === ruleId);
  if (!rule) {
    notFound();
  }

  const [types, workFieldDefinitions, runs, templates] = await Promise.all([
    listWorkItemTypes(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listAutomationRuns(db, { organizationId, ruleId, limit: 10 }),
    listMessageTemplates(db, { organizationId }),
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

  const warnings = await reviewAutomationRules(db, {
    organizationId,
    rules: [rule],
    statuses: everyStatus,
  });
  const mayManage = organization.capabilities.includes('automation.manage');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={rule.name}
        crumbs={[...workspaceAncestry(organizationId, 'automation-rules'), { label: areaLabel('automation-rules'), href: areaHref(organizationId, 'automation-rules') }]}
        meta={mayManage ? undefined : rule.enabled ? 'Enabled' : 'Off'}
        className="mb-0"
      />
      {mayManage ? <RuleHeading organizationId={organizationId} rule={rule} /> : null}

      <RuleWarnings warnings={warnings.map((warning) => warning.message)} />

      {!mayManage ? (
        <Hint>Your role, {organization.role}, cannot change this rule. You can see what it does.</Hint>
      ) : null}

      <section>
        <GroupHeading>When</GroupHeading>
        {/* Read-only: the column grant refuses a change here, because changing what a rule
            watches for makes it a different rule while keeping the record of what the old one
            did. */}
        <p className="mt-1 text-sm">{describeTrigger(rule)}</p>
      </section>

      <ConditionList
        organizationId={organizationId}
        rule={rule}
        statuses={statuses}
        definitions={workFieldDefinitions}
        mayManage={mayManage}
      />

      <ActionList
        organizationId={organizationId}
        rule={rule}
        statuses={statuses}
        templates={templates}
        types={types}
        mayManage={mayManage}
      />

      <RuleActivity runs={runs} />
    </div>
  );
}
