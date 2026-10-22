import type { Db } from '@/lib/db/types';
import { paymentProvider } from '@/lib/adapters/payments';
import { getInvoiceForWorkItem, invoiceStanding } from '@/lib/domain/billing/invoices';
import { listAssets } from '@/lib/domain/assets/assets';
import { listContacts } from '@/lib/domain/contacts/contacts';
import { listDocuments } from '@/lib/domain/documents/documents';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { listResources } from '@/lib/domain/resources/resources';
import { activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listWorkItemTimeline } from '@/lib/domain/timeline/timeline';
import { listChecklistItems } from '@/lib/domain/work-items/checklists';
import { listCosts, listTimeEntries } from '@/lib/domain/work-items/consumption';
import { jobEconomics } from '@/lib/domain/work-items/economics';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import {
  coverageView,
  evaluateRequirements,
  listResourceRequirements,
  requirementGroups,
} from '@/lib/domain/work-items/requirements';
import { workItemIntake } from '@/lib/domain/booking/intake';
import { getWorkItem } from '@/lib/domain/work-items/work-items';
import { checkWorkTypeFeasibility } from '@/lib/domain/scheduling/feasibility';

export async function loadWorkItemDetail(db: Db, input: { organizationId: string; workItemId: string; capabilities: string[]; timeZone?: string }) {
  const workItem = await getWorkItem(db, input);
  if (!workItem) return null;
  const { organizationId, workItemId } = input;
  const [checklist, timeEntries, costs, resources, definitions, lines, priceBook, customers, locations, assets, invoice, resolvedFeatures, statuses, transitions, documents, timeline, intake] = await Promise.all([
    listChecklistItems(db, { organizationId, workItemId }), listTimeEntries(db, { organizationId, workItemId }), listCosts(db, { organizationId, workItemId }),
    listResources(db, { organizationId }), listFieldDefinitions(db, { organizationId, entityType: 'work_item' }), listPricedLines(db, { organizationId, workItemId }),
    listPriceBookItems(db, { organizationId }), listContacts(db, { organizationId }), listLocations(db, { organizationId }), listAssets(db, { organizationId }),
    getInvoiceForWorkItem(db, { organizationId, workItemId }), organizationResolvedFeatureStates(db, { organizationId }),
    listWorkItemStatuses(db, { organizationId, typeId: workItem.type.id }), listWorkItemTransitions(db, { organizationId, typeId: workItem.type.id }),
    listDocuments(db, { organizationId, attachedTo: { entity: 'work_item', id: workItemId } }), listWorkItemTimeline(db, { organizationId, workItemId }),
    workItemIntake(db, { organizationId, workItemId }),
  ]);
  const enabledModules = activeModuleKeys(resolvedFeatures);

  // What this kind of work needs, and whether this job has it. Derived on every read: the type is the
  // authority, nothing is copied onto the job, and a short job is simply reported as short.
  const requirements = await listResourceRequirements(db, { organizationId, typeId: workItem.type.id });
  const needs = requirements.length > 0 ? requirementGroups(requirements, resources, RESOURCE_CLASS_LABELS) : null;
  const assignedIds = new Set(workItem.resources.map((resource) => resource.id));
  const coverage =
    requirements.length > 0
      ? coverageView(evaluateRequirements(requirements, resources.filter((resource) => assignedIds.has(resource.id))), RESOURCE_CLASS_LABELS)
      : null;

  // A scheduled job that is short of what it needs: is a complete set available at its own time? Asked
  // only here, for one job, because it is a calculation and not something a list should run per row.
  // The job's own assignments are set aside and preferred, so the suggestion keeps who is already on it.
  const suggestion =
    coverage && !coverage.satisfied && workItem.window && input.capabilities.includes('work_item.schedule')
      ? await suggestCompleteSet(db, { organizationId, workItem, resources, assignedIds, timeZone: input.timeZone ?? 'UTC' })
      : null;

  return {
    needs, coverage, suggestion, intake,
    workItem, checklist, timeEntries, costs, resources, definitions, lines, priceBook, customers, locations, assets, invoice, resolvedFeatures, statuses, transitions, documents, timeline,
    price: priceWorkItem(lines), economics: jobEconomics({ lines, costs }), standing: invoice ? invoiceStanding(invoice) : null,
    mayAttach: input.capabilities.includes('document.create'), billingEnabled: enabledModules.has('billing'), assetsEnabled: enabledModules.has('assets'),
    cardsAccepted: (await paymentProvider()) !== null && enabledModules.has('card_payments'),
    resourceOptions: resources.map((resource) => ({ id: resource.id, label: resource.name })),
    mayEditDetails: input.capabilities.includes('work_item.update'),
    capabilities: new Set(input.capabilities),
  };
}

async function suggestCompleteSet(
  db: Db,
  input: {
    organizationId: string;
    workItem: NonNullable<Awaited<ReturnType<typeof getWorkItem>>>;
    resources: { id: string; name: string }[];
    assignedIds: Set<string>;
    timeZone: string;
  },
): Promise<{ names: string[]; resourceIds: string[] } | null> {
  const window = input.workItem.window;
  if (!window) return null;
  const result = await checkWorkTypeFeasibility(db, {
    organizationId: input.organizationId,
    workTypeId: input.workItem.type.id,
    timeZone: input.timeZone,
    start: window.startsAt,
    end: window.endsAt,
    excludeWorkItemId: input.workItem.id,
    locationId: input.workItem.location?.id ?? null,
    prefer: [...input.assignedIds],
  });
  if (!result.feasible || !result.combination) return null;

  // What is already on the job stays on it — extras beyond the requirements included; the suggestion adds.
  const resourceIds = [...new Set([...input.assignedIds, ...result.combination.map((entry) => entry.resourceId)])];
  const name = new Map(input.resources.map((resource) => [resource.id, resource.name]));
  const added = result.combination.map((entry) => entry.resourceId).filter((id) => !input.assignedIds.has(id));
  return { resourceIds, names: added.map((id) => name.get(id) ?? 'A resource') };
}

export type WorkItemDetailModel = NonNullable<Awaited<ReturnType<typeof loadWorkItemDetail>>>;
