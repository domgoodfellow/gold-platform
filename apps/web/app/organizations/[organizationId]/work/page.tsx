import { WorkList } from '@/features/work/work-list';
import { redirect } from 'next/navigation';
import { newWorkHref } from '@/features/work/new-work-action';
import { AppPage } from '@/components/layout/app-page';
import { counted } from '@/lib/domain/counted';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listResources } from '@/lib/domain/resources/resources';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { listBookingIntakeForms } from '@/lib/domain/booking/intake';
import { getTypeBooking, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItems, type WorkItem } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import { ConfigureRegistrar } from '@/components/panels/configure-registrar';
import { SupportRegistrar } from '@/components/panels/support-registrar';
import { WorkInsights } from '@/features/insights/workspace-insights';
import { WorkspaceActivity } from '@/features/timeline/workspace-activity';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listResourceCapabilities } from '@/lib/domain/resources/resource-capabilities';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import {
  coverageView,
  evaluateRequirements,
  listResourceRequirements,
  type CoverageView,
} from '@/lib/domain/work-items/requirements';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable, areaLabel, workspaceAncestry } from '@/lib/navigation';
import { parseWorkDirectory, workDirectoryHref, WORK_PAGE_SIZE } from '@/features/work/work-directory';
import { WorkConfiguration } from '@/features/work/configuration/work-configuration';

export const dynamic = 'force-dynamic';

/** Work route authority and URL-owned board selection; the feature owns the operator view. */
export default async function WorkPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const { create } = query;
  const view = parseWorkDirectory(query);
  const { q, page, sort } = view;
  const { db, organization } = await requireOrganization(organizationId);
  if (create === '1') redirect(newWorkHref(organizationId, view.type));
  const types = await listWorkItemTypes(db, { organizationId });
  const selectedType = types.find((type) => type.id === view.type) ?? types[0] ?? null;
  const statuses = selectedType ? await listWorkItemStatuses(db, { organizationId, typeId: selectedType.id }) : [];
  const statusId = statuses.find(s => s.id === view.status)?.id;
  // A status belongs to one type, and the Board shows every status: an address that keeps one it
  // cannot use (from another type, or on the Board) is rewritten without it rather than half-applied.
  if (view.status && (!statusId || view.view === 'board')) redirect(workDirectoryHref(organizationId, { ...view, type: selectedType?.id }, { status: undefined, page: view.page }));
  const [transitions, workItems, resources, definitions, enabledModules, templateSteps, prices, booking, requirements, capabilities, intakeForms] = await Promise.all([
    selectedType ? listWorkItemTransitions(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    selectedType && view.view === 'list' ? listWorkItems(db, { organizationId, typeId: selectedType.id, q, statusId, limit: WORK_PAGE_SIZE, offset: (page - 1) * WORK_PAGE_SIZE, sort }) : Promise.resolve(counted([] as WorkItem[], 0)),
    listResources(db, { organizationId, limit: 1000 }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listUsableModules(db, { organizationId }),
    selectedType ? listTypeChecklistItems(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    listPriceBookItems(db, { organizationId }),
    selectedType ? getTypeBooking(db, { organizationId, typeId: selectedType.id }) : Promise.resolve(null),
    selectedType ? listResourceRequirements(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    listResourceCapabilities(db, { organizationId }),
    listBookingIntakeForms(db, { organizationId }),
  ]);

  const stageLists = view.view === 'board' ? await Promise.all(statuses.map(status => listWorkItems(db, { organizationId, typeId: selectedType!.id, statusId: status.id, q, limit: 10, sort }))) : [];
  const stages = Object.fromEntries(statuses.map((s, i) => [s.id, stageLists[i]]));

  // What the selected kind of work needs against who is on each job — derived on this read from the
  // type's requirements and the assignments, stored nowhere.
  const resourcesById = new Map(resources.map((resource) => [resource.id, resource]));
  const coverage: Record<string, CoverageView> = {};
  for (const item of [...workItems, ...stageLists.flat()]) {
    if (requirements.length === 0) break;
    const assigned = item.resources.flatMap((ref) => resourcesById.get(ref.id) ?? []);
    coverage[item.id] = coverageView(evaluateRequirements(requirements, assigned), RESOURCE_CLASS_LABELS);
  }

  const can = (capability: Capability) => organization.capabilities.includes(capability);
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
        >
          <WorkInsights db={db} organizationId={organizationId} today={todayInZone(organization.timezone)} />
        </SupportRegistrar>
      ) : null}
      {mayConfigure ? (
        <ConfigureRegistrar
          title="Work configuration"
          settingsHref={`/organizations/${organizationId}/work/configuration${selectedType ? `?type=${selectedType.id}` : ''}`}
        >
          <WorkConfiguration
            variant="rail"
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
            requirements={requirements}
            capabilities={capabilities}
            intakeForms={intakeForms}
            typeHref={(typeId) => `/organizations/${organizationId}/work?type=${typeId}`}
          />
        </ConfigureRegistrar>
      ) : null}
      <WorkList
        title={areaLabel('work')}
        crumbs={workspaceAncestry(organizationId, 'work')}
        view={{ ...view, type: selectedType?.id }}
        stages={stages}
        organizationId={organizationId}
        timezone={organization.timezone}
        types={types}
        selectedType={selectedType}
        statuses={statuses}
        transitions={transitions}
        workItems={workItems}
        coverage={coverage}
        mayAdd={can('work_item.create')}
        mayConfigure={mayConfigure}
        mayMove={can('work_item.transition')}
        maySchedule={can('work_item.schedule')}
        activity={types.length > 0}
        insights={mayInsight && types.length > 0}
        configure={mayConfigure}
      />
    </AppPage>
  );
}
