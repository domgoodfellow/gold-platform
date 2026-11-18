import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listAutomationRules, listAutomationRuns } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { listMessageTemplates } from '@/lib/domain/automation/templates';
import { projectRule } from '@/lib/domain/automation/workflow-graph';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listToolChoices } from '@/lib/domain/integrations/tool-access';
import { WorkflowWorkbench } from '@/features/automations/workbench/workflow-workbench';
import { PageLocation } from '@/components/navigation/page-location';
import { areaHref, areaLabel, workspaceAncestry } from '@/lib/navigation';

export const dynamic = 'force-dynamic';

export default async function AutomationWorkflowPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations/workflows/[ruleId]'>) {
  const { organizationId, ruleId } = await params;
  const query = await searchParams;
  const first = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const { db, organization } = await requireOrganization(organizationId);

  // Another business's rule id resolves to nothing here, so this 404s rather than rendering empty —
  // the same indistinguishability RLS already gives `getResource` and its siblings.
  const rules = await listAutomationRules(db, { organizationId });
  const rule = rules.find((entry) => entry.id === ruleId);
  if (!rule) {
    notFound();
  }

  const [types, workFieldDefinitions, templates, recentRuns] = await Promise.all([
    listWorkItemTypes(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listMessageTemplates(db, { organizationId }),
    listAutomationRuns(db, { organizationId, ruleId, limit: 5 }),
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
    rules,
    includeDisabled: true,
    statuses: everyStatus,
  });
  const graph = projectRule(rule, {
    references: {
      statuses,
      templates: templates.map((template) => ({ id: template.id, name: template.name })),
      types: types.map((type) => ({ id: type.id, name: type.name })),
      fields: workFieldDefinitions.map((definition) => ({ key: definition.key, label: definition.label })),
    },
    warnings: warnings.filter((warning) => warning.ruleId === ruleId).map((warning) => warning.message),
  });
  const mayManage = organization.capabilities.includes('automation.manage');
  // Wiring a connected app into a rule also creates a grant, so it is offered only to someone who may do both.
  const toolChoices =
    mayManage && organization.capabilities.includes('integration.manage')
      ? await listToolChoices(db, { organizationId }).catch(() => [])
      : [];
  const view = first('view');

  return (
    <>
      <PageLocation
        crumbs={[...workspaceAncestry(organizationId, 'automation-rules'), { label: areaLabel('automation-rules'), href: areaHref(organizationId, 'automation-rules') }]}
        current={rule.name}
      />
      <WorkflowWorkbench
        organizationId={organizationId}
        rule={rule}
        graph={graph}
        statuses={statuses}
        templates={templates}
        types={types}
        definitions={workFieldDefinitions}
        recentRuns={recentRuns}
        timezone={organization.timezone}
        mayManage={mayManage}
        initialNode={first('node')}
        initialView={view === 'list' || view === 'canvas' ? view : undefined}
        toolChoices={toolChoices}
      />
    </>
  );
}
