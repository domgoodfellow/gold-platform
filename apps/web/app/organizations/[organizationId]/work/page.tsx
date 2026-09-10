import { WorkList } from '@/features/work/work-list';
import { listAssets } from '@/lib/domain/assets/assets';
import { counted } from '@/lib/domain/counted';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResources } from '@/lib/domain/resources/resources';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItems, type WorkItem } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/** Work route authority and URL-owned board selection; the feature owns the operator view. */
export default async function WorkPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work'>) {
  const { organizationId } = await params;
  const { type: requestedType } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  const types = await listWorkItemTypes(db, { organizationId });
  const selectedType = types.find((type) => type.id === requestedType) ?? types[0] ?? null;
  const [statuses, transitions, workItems, customers, locations, resources, assets, definitions, enabledModules] = await Promise.all([
    selectedType ? listWorkItemStatuses(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    selectedType ? listWorkItemTransitions(db, { organizationId, typeId: selectedType.id }) : Promise.resolve([]),
    selectedType ? listWorkItems(db, { organizationId, typeId: selectedType.id }) : Promise.resolve(counted([] as WorkItem[], 0)),
    listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }),
    listResources(db, { organizationId }),
    listAssets(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listUsableModules(db, { organizationId }),
  ]);

  const can = (capability: Capability) => organization.capabilities.includes(capability);
  const assetsEnabled = enabledModules.has('assets');
  return (
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
      mayConfigure={can('field.manage')}
      mayMove={can('work_item.transition')}
      maySchedule={can('work_item.schedule')}
    />
  );
}
