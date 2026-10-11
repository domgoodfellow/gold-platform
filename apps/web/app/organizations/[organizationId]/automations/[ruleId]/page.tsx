import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listAutomationRules } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { listMessageTemplates } from '@/lib/domain/automation/templates';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { RuleBuilder } from '@/features/automations/rules/rule-builder';
import { listToolChoices } from '@/lib/domain/integrations/tool-access';

export const dynamic = 'force-dynamic';

export default async function AutomationRulePage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations/[ruleId]'>) {
  const { organizationId, ruleId } = await params;
  const query = await searchParams;
  const initialNode = Array.isArray(query.node) ? query.node[0] : query.node;
  const { db, organization } = await requireOrganization(organizationId);

  // Another tenant's rule id resolves to nothing here, so this 404s rather than rendering empty —
  // the same indistinguishability RLS already gives `getResource` and its siblings.
  const rules = await listAutomationRules(db, { organizationId });
  const rule = rules.find((entry) => entry.id === ruleId);
  if (!rule) {
    notFound();
  }

  const [types, workFieldDefinitions, templates] = await Promise.all([
    listWorkItemTypes(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listMessageTemplates(db, { organizationId }),
  ]);

  const everyStatus = (
    await Promise.all(
      types.map(async (type) => {
        const own = await listWorkItemStatuses(db, {
          organizationId,
          typeId: type.id,
        });
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
  const statuses = everyStatus.map((status) => ({
    id: status.id,
    label: status.label,
  }));

  const warnings = await reviewAutomationRules(db, {
    organizationId,
    rules,
    includeDisabled: true,
    statuses: everyStatus,
  });
  const mayManage = organization.capabilities.includes('automation.manage');
  // Wiring a connected app into a rule also creates a grant, so it is offered only to someone who may do both.
  const toolChoices =
    mayManage && organization.capabilities.includes('integration.manage')
      ? await listToolChoices(db, { organizationId }).catch(() => [])
      : [];

  return (
    <RuleBuilder
      organizationId={organizationId}
      rule={rule}
      statuses={statuses}
      templates={templates}
      types={types}
      definitions={workFieldDefinitions}
      warnings={warnings
        .filter((w) => w.ruleId === ruleId)
        .map((w) => w.message)}
      mayManage={mayManage}
      initialNode={initialNode}
      toolChoices={toolChoices}
    />
  );
}
