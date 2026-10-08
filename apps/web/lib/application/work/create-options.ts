import type { Db } from '@/lib/db/types';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResources } from '@/lib/domain/resources/resources';
import { listAssets } from '@/lib/domain/assets/assets';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import type { WorkItemType } from '@/lib/domain/work-items/types';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
type Option = { id: string; label: string };
export type WorkCreateOptions = { organizationId: string; types: WorkItemType[]; statusesByType: Record<string, WorkItemStatus[]>;
  customers: Option[]; locations: Option[]; resources: Option[]; assets: Option[]; definitions: FieldDefinition[]; assetsEnabled: boolean };


export async function workCreateOptions(db: Db, organizationId: string, assetsEnabled: boolean): Promise<WorkCreateOptions> {
  const [types, customers, locations, resources, assets, definitions] = await Promise.all([
    listWorkItemTypes(db, { organizationId }), listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }), listResources(db, { organizationId }),
    assetsEnabled ? listAssets(db, { organizationId }) : Promise.resolve([]),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
  ]);
  const statuses = await Promise.all(types.map(t => listWorkItemStatuses(db, { organizationId, typeId: t.id })));
  const options = (rows: { id: string; name?: string; label?: string }[]) => rows.map(r => ({ id: r.id, label: r.name ?? r.label ?? '' }));
  return { organizationId, types, statusesByType: Object.fromEntries(types.map((t, i) => [t.id, statuses[i]])),
    customers: options(customers), locations: options(locations), resources: options(resources), assets: options(assets), definitions, assetsEnabled };
}
