import type { Db } from '@/lib/db/types';
import { paymentProvider } from '@/lib/adapters/payments';
import { getInvoiceForWorkItem, invoiceStanding } from '@/lib/domain/billing/invoices';
import { listAssets } from '@/lib/domain/assets/assets';
import { listCustomers } from '@/lib/domain/customers/customers';
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
import { getWorkItem } from '@/lib/domain/work-items/work-items';

export async function loadWorkItemDetail(db: Db, input: { organizationId: string; workItemId: string; capabilities: string[] }) {
  const workItem = await getWorkItem(db, input);
  if (!workItem) return null;
  const { organizationId, workItemId } = input;
  const [checklist, timeEntries, costs, resources, definitions, lines, priceBook, customers, locations, assets, invoice, resolvedFeatures, statuses, transitions, documents, timeline] = await Promise.all([
    listChecklistItems(db, { organizationId, workItemId }), listTimeEntries(db, { organizationId, workItemId }), listCosts(db, { organizationId, workItemId }),
    listResources(db, { organizationId }), listFieldDefinitions(db, { organizationId, entityType: 'work_item' }), listPricedLines(db, { organizationId, workItemId }),
    listPriceBookItems(db, { organizationId }), listCustomers(db, { organizationId }), listLocations(db, { organizationId }), listAssets(db, { organizationId }),
    getInvoiceForWorkItem(db, { organizationId, workItemId }), organizationResolvedFeatureStates(db, { organizationId }),
    listWorkItemStatuses(db, { organizationId, typeId: workItem.type.id }), listWorkItemTransitions(db, { organizationId, typeId: workItem.type.id }),
    listDocuments(db, { organizationId, attachedTo: { entity: 'work_item', id: workItemId } }), listWorkItemTimeline(db, { organizationId, workItemId }),
  ]);
  const enabledModules = activeModuleKeys(resolvedFeatures);
  return {
    workItem, checklist, timeEntries, costs, resources, definitions, lines, priceBook, customers, locations, assets, invoice, resolvedFeatures, statuses, transitions, documents, timeline,
    price: priceWorkItem(lines), economics: jobEconomics({ lines, costs }), standing: invoice ? invoiceStanding(invoice) : null,
    mayAttach: input.capabilities.includes('document.create'), billingEnabled: enabledModules.has('billing'), assetsEnabled: enabledModules.has('assets'),
    cardsAccepted: (await paymentProvider()) !== null && enabledModules.has('card_payments'),
    resourceOptions: resources.map((resource) => ({ id: resource.id, label: resource.name })),
    mayEditDetails: input.capabilities.includes('work_item.update'),
    capabilities: new Set(input.capabilities),
  };
}

export type WorkItemDetailModel = NonNullable<Awaited<ReturnType<typeof loadWorkItemDetail>>>;
