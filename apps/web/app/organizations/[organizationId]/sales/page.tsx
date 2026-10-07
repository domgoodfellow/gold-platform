import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { SupportRegistrar } from '@/components/panels/support-registrar';
import { ButtonLink } from '@/components/controls/button';
import { CreateCustomerSheetProvider } from '@/features/crm/customers/create-customer-sheet';
import { CustomerConfiguration } from '@/features/crm/customers/customer-configuration';
import { CrmHome } from '@/features/crm/home/crm-home';
import { CustomersInsights } from '@/features/insights/workspace-insights';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCustomerStages } from '@/lib/domain/customers/stages';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable, configTarget, configTargetOffered } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

export default async function SalesPage({ params }: PageProps<'/organizations/[organizationId]/sales'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [resolvedFeatures, customers, definitions] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    listCustomers(db, { organizationId, limit: 5 }),
    listFieldDefinitions(db, { organizationId, entityType: 'customer' }),
  ]);
  const modules = activeModuleKeys(resolvedFeatures);
  const features = availableFeatureKeys(resolvedFeatures);
  const capabilities = new Set(organization.capabilities);
  const availability = { enabled: modules, featureAvailability: features, capabilities };
  const pipelineAvailable = areaAvailable('pipeline', availability);
  const gate = { enabledModules: modules, featureAvailability: features, capabilities };
  const fieldsTarget = configTarget('custom-fields');
  const stagesTarget = configTarget('sales-stages');
  const mayConfigure = configTargetOffered(fieldsTarget, gate);
  const mayConfigureStages = configTargetOffered(stagesTarget, gate);
  const mayCreate = capabilities.has('customer.create');
  const mayImport = modules.has('integrations') && features.has('file_imports') && capabilities.has('integration.manage');
  const mayInsight = areaAvailable('insights', availability) && capabilities.has('report.read');
  const settingsHref = (path: string) => `/organizations/${organizationId}/${path}`;
  const stages = pipelineAvailable ? await listCustomerStages(db, { organizationId }) : [];
  // Exact canonical counts, never counts over the five recent rows (or LIST_LIMIT).
  const [unstaged, stageCounts] = await Promise.all([
    pipelineAvailable ? listCustomers(db, { organizationId, stageId: null, limit: 1 }) : Promise.resolve(null),
    Promise.all(stages.map(async (stage) => {
      const result = await listCustomers(db, { organizationId, stageId: stage.id, limit: 1 });
      return { ...stage, count: result.total };
    })),
  ]);

  const home = (
    <>
      <CrmHome
        organizationId={organizationId}
        timezone={organization.timezone}
        customers={customers}
        totalCustomers={customers.total}
        pipeline={unstaged ? { stages: stageCounts, unstaged: unstaged.total } : null}
        stagesSettingsHref={mayConfigureStages ? settingsHref(stagesTarget.path) : undefined}
        mayCreate={mayCreate}
        mayImport={mayImport}
        mayConfigure={mayConfigure}
        mayInsight={mayInsight}
        activity={<WorkspaceActivity db={db} organizationId={organizationId} timezone={organization.timezone} scope="customers" limit={5} emptyMessage="No CRM activity yet." />}
      />
      {mayInsight ? (
        <SupportRegistrar mode="insights" title="Customer insights">
          <CustomersInsights db={db} organizationId={organizationId} today={todayInZone(organization.timezone)} salesEnabled={pipelineAvailable} />
        </SupportRegistrar>
      ) : null}
      {mayConfigure ? (
        <ConfigureRegistrar title="CRM configuration" settingsHref={settingsHref(fieldsTarget.path)}>
          <div className="mb-6 flex flex-wrap gap-2">
            <ButtonLink tone="secondary" href={settingsHref(fieldsTarget.path)}>Custom field settings</ButtonLink>
            {mayConfigureStages ? <ButtonLink tone="secondary" href={settingsHref(stagesTarget.path)}>Sales-stage settings</ButtonLink> : null}
          </div>
          <CustomerConfiguration organizationId={organizationId} role={organization.role} mayConfigure={mayConfigure} definitions={definitions} stages={stages} salesEnabled={pipelineAvailable} />
        </ConfigureRegistrar>
      ) : null}
    </>
  );
  return mayCreate ? (
    <CreateCustomerSheetProvider organizationId={organizationId} definitions={definitions}>{home}</CreateCustomerSheetProvider>
  ) : home;
}
