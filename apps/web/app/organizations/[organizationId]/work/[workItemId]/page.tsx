import { notFound } from 'next/navigation';
import { paymentProvider } from '@/lib/adapters/payments';
import { getInvoiceForWorkItem, invoiceStanding } from '@/lib/domain/billing/invoices';
import { listAssets } from '@/lib/domain/assets/assets';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { listResources } from '@/lib/domain/resources/resources';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import type { Capability } from '@/lib/domain/tenancy/capabilities';
import { listChecklistItems } from '@/lib/domain/work-items/checklists';
import { listCosts, listTimeEntries } from '@/lib/domain/work-items/consumption';
import { jobEconomics } from '@/lib/domain/work-items/economics';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import {
  WorkChecklistSection,
  WorkCostSection,
  WorkDetailsSection,
  WorkIdentity,
  WorkInvoiceSection,
  WorkMarginSection,
  WorkOperationalActions,
  WorkQuoteSection,
  WorkRecordHeader,
  WorkTimeSection,
} from '@/features/work/work-item-sections';

export const dynamic = 'force-dynamic';

/** Authoritative loading and capability resolution for one job; presentation lives in Work. */
export default async function WorkItemPage({
  params,
}: PageProps<'/organizations/[organizationId]/work/[workItemId]'>) {
  const { organizationId, workItemId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const workItem = (await listWorkItems(db, { organizationId })).find((item) => item.id === workItemId);
  if (!workItem) notFound();

  const [
    checklist,
    timeEntries,
    costs,
    resources,
    definitions,
    lines,
    priceBook,
    customers,
    locations,
    assets,
    invoice,
    enabledModules,
    statuses,
    transitions,
  ] = await Promise.all([
    listChecklistItems(db, { organizationId, workItemId }),
    listTimeEntries(db, { organizationId, workItemId }),
    listCosts(db, { organizationId, workItemId }),
    listResources(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listPricedLines(db, { organizationId, workItemId }),
    listPriceBookItems(db, { organizationId }),
    listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }),
    listAssets(db, { organizationId }),
    getInvoiceForWorkItem(db, { organizationId, workItemId }),
    listUsableModules(db, { organizationId }),
    listWorkItemStatuses(db, { organizationId, typeId: workItem.type.id }),
    listWorkItemTransitions(db, { organizationId, typeId: workItem.type.id }),
  ]);

  const price = priceWorkItem(lines);
  const economics = jobEconomics({ lines, costs });
  const standing = invoice ? invoiceStanding(invoice) : null;
  const can = (capability: Capability) => organization.capabilities.includes(capability);
  const billingEnabled = enabledModules.has('billing');
  const assetsEnabled = enabledModules.has('assets');
  const cardsAccepted = (await paymentProvider()) !== null && enabledModules.has('card_payments');
  const resourceOptions = resources.map((resource) => ({ id: resource.id, label: resource.name }));

  return (
    <>
      <WorkRecordHeader
        organizationId={organizationId}
        workItem={workItem}
        timezone={organization.timezone}
      />
      <WorkIdentity
        workItem={workItem}
        definitions={definitions}
        assetsEnabled={assetsEnabled}
      />
      <WorkOperationalActions
        organizationId={organizationId}
        workItem={workItem}
        statuses={statuses}
        transitions={transitions}
        resources={resourceOptions}
        mayMove={can('work_item.transition')}
        maySchedule={can('work_item.schedule')}
      />
      <WorkChecklistSection
        organizationId={organizationId}
        workItemId={workItemId}
        checklist={checklist}
        mayTick={can('work_item.transition')}
        mayAdd={can('work_item.create')}
      />
      <WorkTimeSection
        organizationId={organizationId}
        workItemId={workItemId}
        timeEntries={timeEntries}
        resources={resourceOptions}
        timezone={organization.timezone}
        mayRecord={can('work_item.record')}
      />
      <WorkDetailsSection
        organizationId={organizationId}
        workItem={workItem}
        customers={customers.map((item) => ({ id: item.id, label: item.name }))}
        locations={locations.map((item) => ({ id: item.id, label: item.label }))}
        assets={assets.map((item) => ({ id: item.id, label: item.name }))}
        assetsEnabled={assetsEnabled}
        definitions={definitions}
        mayEdit={can('work_item.update')}
      />
      {billingEnabled ? (
        <WorkQuoteSection
          organizationId={organizationId}
          workItemId={workItemId}
          lines={lines}
          price={price}
          priceBook={priceBook}
          mayPrice={can('work_item.price')}
        />
      ) : null}
      <WorkCostSection
        organizationId={organizationId}
        workItemId={workItemId}
        costs={costs}
        economics={economics}
        currency={organization.currency}
        mayRecord={can('work_item.record')}
      />
      {billingEnabled ? (
        <WorkInvoiceSection
          organizationId={organizationId}
          workItemId={workItemId}
          invoice={invoice}
          standing={standing}
          price={price}
          timezone={organization.timezone}
          cardsAccepted={cardsAccepted}
          mayInvoice={can('invoice.issue')}
          mayBePaid={can('payment.record')}
        />
      ) : null}
      {billingEnabled ? <WorkMarginSection economics={economics} /> : null}
    </>
  );
}
