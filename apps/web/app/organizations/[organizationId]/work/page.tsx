import { WorkList } from '@/features/work/work-list';
import { AppPage } from '@/components/containers/app-page';
import { listAssets } from '@/lib/domain/assets/assets';
import { counted } from '@/lib/domain/counted';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listResources } from '@/lib/domain/resources/resources';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { getTypeBooking, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItems, type WorkItem } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { SupportRegistrar } from '@/components/containers/support-registrar';
import { WorkInsights } from '@/features/insights/workspace-insights';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable, areaHref, areaLabel, workspaceAncestry } from '@/lib/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { WorkConfiguration } from '@/features/work/configuration/work-configuration';

export const dynamic = 'force-dynamic';

/** Work route authority and URL-owned board selection; the feature owns the operator view. */
export default async function WorkPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work'>) {
  const { organizationId } = await params;
  const { type: requestedType } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const types = await listWorkItemTypes(db, { organizationId });
  const selectedType = types.find((type) => type.id === requestedType) ?? types[0] ?? null;
  const [statuses, transitions, workItems, customers, locations, resources, assets, definitions, enabledModules, templateSteps, prices, booking] = await Promise.all([
    selectedType ? listWorkItemStatuses(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    selectedType ? listWorkItemTransitions(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    selectedType ? listWorkItems(db, { organizationId, typeId: selectedType.id }) : Promise.resolve(counted([] as WorkItem[], 0)),
    listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }),
    listResources(db, { organizationId }),
    listAssets(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listUsableModules(db, { organizationId }),
    selectedType ? listTypeChecklistItems(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    listPriceBookItems(db, { organizationId }),
    selectedType ? getTypeBooking(db, { organizationId, typeId: selectedType.id }) : Promise.resolve(null),
  ]);

  const can = (capability: Capability) => organization.capabilities.includes(capability);
  const assetsEnabled = enabledModules.has('assets');
  const mayConfigure = can('field.manage');
  const mayInsight =
    areaAvailable('insights', {
      enabled: enabledModules,
      capabilities: new Set(organization.capabilities),
      featureAvailability: availableFeatureKeys(await organizationResolvedFeatureStates(db, { organizationId })),
    }) && can('report.read');

  return (
    <AppPage>
      {types.length > 0 ? <SupportRegistrar mode="activity" title="Work activity">
        <WorkspaceActivity
          db={db}
          organizationId={organizationId}
          timezone={organization.timezone}
          scope="work"
          emptyMessage="No work activity yet."
        />
      </SupportRegistrar> : null}
      {mayInsight && types.length > 0 ? (
        <SupportRegistrar
          mode="insights"
          title="Work insights"
          href={`${areaHref(organizationId, 'insights')}/reports?of=work_marked_complete&by=customer&period=month`}
          hrefLabel="Full report"
        >
          <WorkInsights db={db} organizationId={organizationId} today={todayInZone(organization.timezone)} />
        </SupportRegistrar>
      ) : null}
      {mayConfigure && types.length > 0 ? (
        <ConfigureRegistrar
          title="Work configuration"
          settingsHref={`/organizations/${organizationId}/work/configuration${selectedType ? `?type=${selectedType.id}` : ''}`}
        >
          <WorkConfiguration
            organizationId={organizationId}
            role={organization.role}
            mayConfigure={mayConfigure}
            types={types}
            selectedType={selectedType}
            statuses={statuses}
            transitions={transitions}
            templateSteps={templateSteps}
            fieldDefinitions={definitions}
            prices={prices}
            booking={booking}
            bookingEnabled={enabledModules.has('booking')}
            typeHref={(typeId) => `/organizations/${organizationId}/work?type=${typeId}`}
          />
        </ConfigureRegistrar>
      ) : null}
      <PageHeader
        title={areaLabel('work')}
        crumbs={workspaceAncestry('work')}
        activity={types.length > 0}
        insights={mayInsight && types.length > 0}
        configure={mayConfigure && types.length > 0}
      />
      <WorkList
        organizationId={organizationId}
        role={organization.role}
        timezone={organization.timezone}
        types={types}
        selectedType={selectedType}
        statuses={statuses}
        transitions={transitions}
        workItems={workItems}
        customers={customers.map((item) => ({ id: item.id, label: item.name }))}
        locations={locations.map((item) => ({ id: item.id, label: item.label }))}
        resources={resources.map((item) => ({ id: item.id, label: item.name }))}
        assets={assets.map((item) => ({ id: item.id, label: item.name }))}
        definitions={definitions}
        assetsEnabled={assetsEnabled}
        mayAdd={can('work_item.create')}
        mayConfigure={mayConfigure}
        mayMove={can('work_item.transition')}
        maySchedule={can('work_item.schedule')}
      />
    </AppPage>
  );
}
