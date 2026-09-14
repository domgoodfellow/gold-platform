import { Hint } from '@/components/controls/inputs';
import { EmptyState, PageHeading, SectionHeading } from '@/components/containers/section';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { requireOrganization } from '@/lib/route/organization';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_ENTITY_LABELS,
  listFieldDefinitions,
  type CustomFieldEntity,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { listAutomationRules, listAutomationRuns } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { listMessageDeliveries, listMessageTemplates } from '@/lib/domain/automation/templates';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { EntityFieldsConfiguration } from '@/features/fields/entity-fields-configuration';
import { AutomationRuleCard } from '@/features/automations/rules/rule-card';
import { CreateAutomationRuleForm } from '@/features/automations/rules/create-rule-form';
import { MessageTemplateSection } from '@/features/automations/templates/template-section';
import { RunLog } from '@/features/automations/activity/run-log';

export const dynamic = 'force-dynamic';

/**
 * "How does our data model differ from the default, and what should the system do
 * automatically?" — Custom fields and Automation rules were two independent top-level areas
 * answering two halves of one configuration question. Both tabs reuse the same components and
 * domain reads their original pages did (`/fields`, `/automations`, both now redirects here) —
 * a relocation, not a rewrite.
 */
export default async function DataAndAutomationSettingsPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/data-automation'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const byEntity = await Promise.all(
    CUSTOM_FIELD_ENTITIES.map(async (entityType): Promise<[CustomFieldEntity, FieldDefinition[]]> => [
      entityType,
      await listFieldDefinitions(db, { organizationId, entityType }),
    ]),
  );
  const mayManageFields = organization.capabilities.includes('field.manage');

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
  const mayManageAutomations = organization.capabilities.includes('automation.manage');

  return (
    <SettingsPageFrame organizationId={organizationId}>
      <PageHeading>Data &amp; automation</PageHeading>
      <Hint className="mt-1">
        What this business records beyond the platform&rsquo;s own fields, and what it does on
        its own when nobody is looking.
      </Hint>

      <Tabs defaultValue="fields" className="mt-6">
        <TabsList>
          <TabsTrigger value="fields">Custom fields</TabsTrigger>
          <TabsTrigger value="automations">Automation rules</TabsTrigger>
        </TabsList>

        <TabsContent value="fields" className="mt-4">
          {byEntity.map(([entityType, definitions]) => (
            <section key={entityType} className="mt-6 first:mt-0">
              <SectionHeading>{CUSTOM_FIELD_ENTITY_LABELS[entityType]}</SectionHeading>
              <div className="mt-2">
                <EntityFieldsConfiguration
                  organizationId={organizationId}
                  entityType={entityType}
                  role={organization.role}
                  mayConfigure={mayManageFields}
                  definitions={definitions}
                />
              </div>
            </section>
          ))}
        </TabsContent>

        <TabsContent value="automations" className="mt-4">
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
                  mayManage={mayManageAutomations}
                />
              ))}
            </div>
          )}

          {mayManageAutomations ? (
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
            mayManage={mayManageAutomations}
            role={organization.role}
          />

          <RunLog runs={runs} />
        </TabsContent>
      </Tabs>
    </SettingsPageFrame>
  );
}
