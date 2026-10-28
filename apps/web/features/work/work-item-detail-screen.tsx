import { ActivityList } from '@/features/timeline/activity-list';
import { WorkItemIntake } from '@/features/work/work-item-intake';
import { DocumentsSection } from '@/features/documents/section';
import { EditWorkItemDialog } from '@/features/work/edit-work-item-sheet';
import { RelatedSupport } from '@/features/support/related';
import type { WorkItemDetailModel } from '@/lib/application/work/work-item-detail';
import { uploadWorkItemDocumentAction } from '@/app/organizations/[organizationId]/work/[workItemId]/actions';
import {
  WorkChecklistSection,
  WorkCostSection,
  WorkIdentity,
  WorkInvoiceSection,
  WorkMarginSection,
  WorkOperationalActions,
  WorkQuoteSection,
  WorkRecordHeader,
  WorkRecordNavigation,
  WorkRequirementsSection,
  WorkTimeSection,
} from '@/features/work/work-item-sections';
import type { WorkSection } from '@/features/work/work-record-sections';

/**
 * The Work record: its identity and Edit details, then five sections, each its own address
 * (`?section=`), drawn one at a time. Every gating condition (billing, module, capability) is the
 * one the sections always had; an action someone may not take is not drawn, and the server still
 * checks every command.
 */
export function WorkItemDetailScreen({ organizationId, organization, model, section, today }: { organizationId: string; organization: { timezone: string; currency: string | null; role: string }; model: WorkItemDetailModel; section: WorkSection; today: string }) {
  const { workItem, checklist, timeEntries, costs, definitions, lines, priceBook, customers, locations,
    assets, invoice, statuses, transitions, documents, timeline, price, economics, standing, mayAttach,
    billingEnabled, assetsEnabled, cardsAccepted, resourceOptions, mayEditDetails, needs, coverage, suggestion, intake } = model;
  const workItemId = workItem.id;
  const can = (capability: string) => model.capabilities.has(capability);

  const content = {
    overview: () => <div className="flex flex-col gap-6">
      <WorkIdentity organizationId={organizationId} workItem={workItem} definitions={definitions} assetsEnabled={assetsEnabled} />
      <WorkItemIntake organizationId={organizationId} intake={intake} timezone={organization.timezone} />
      <RelatedSupport organizationId={organizationId} kind="work_item" recordId={workItemId} customerId={workItem.customer?.id} />
    </div>,
    execution: () => <>
      <WorkOperationalActions organizationId={organizationId} timezone={organization.timezone} workItem={workItem} statuses={statuses} transitions={transitions}
        resources={resourceOptions} needs={needs} mayMove={can('work_item.transition')} maySchedule={can('work_item.schedule')} />
      {workItem.type.schedulable ? <WorkRequirementsSection coverage={coverage} suggestion={suggestion} organizationId={organizationId} workItemId={workItemId} /> : null}
      <WorkChecklistSection organizationId={organizationId} workItemId={workItemId} checklist={checklist} mayTick={can('work_item.transition')} mayAdd={can('work_item.create')} />
      <WorkTimeSection organizationId={organizationId} workItemId={workItemId} timeEntries={timeEntries} resources={resourceOptions} timezone={organization.timezone} mayRecord={can('work_item.record')} />
    </>,
    financials: () => <>
      {billingEnabled ? <WorkQuoteSection organizationId={organizationId} workItemId={workItemId} lines={lines} price={price} priceBookCount={priceBook.length}
        mayPrice={can('work_item.price')} mayManageCatalog={can('price.manage')} /> : null}
      <WorkCostSection organizationId={organizationId} workItemId={workItemId} costs={costs} economics={economics} currency={organization.currency} mayRecord={can('work_item.record')} />
      {billingEnabled ? <WorkInvoiceSection organizationId={organizationId} workItemId={workItemId} invoice={invoice} standing={standing} price={price} timezone={organization.timezone}
        today={today} cardsAccepted={cardsAccepted} mayInvoice={can('invoice.issue')} mayBePaid={can('payment.record')} /> : null}
      {billingEnabled ? <WorkMarginSection economics={economics} /> : null}
    </>,
    documents: () => <DocumentsSection organizationId={organizationId} documents={documents} mayAttach={mayAttach}
      uploadAction={uploadWorkItemDocumentAction} hiddenFields={{ organizationId, workItemId }} className="mt-0 border-t-0 pt-0" />,
    // Not capability-gated, deliberately, the same as a contact's: the table is append-only and
    // RLS has already restricted every row to this tenant.
    activity: () => <ActivityList timeline={timeline} timezone={organization.timezone} />,
  } satisfies Record<WorkSection, () => React.ReactNode>;

  return (
    <>
      <WorkRecordHeader organizationId={organizationId} workItem={workItem} timezone={organization.timezone}
        actions={mayEditDetails ? <EditWorkItemDialog organizationId={organizationId} workItem={workItem}
          customers={customers.map((item) => ({ id: item.id, label: item.name }))}
          locations={locations.map((item) => ({ id: item.id, label: item.label }))}
          assets={assets.map((item) => ({ id: item.id, label: item.name }))}
          assetsEnabled={assetsEnabled} definitions={definitions} /> : undefined} />
      <WorkRecordNavigation organizationId={organizationId} workItemId={workItemId} current={section} />
      <div className="min-w-0">{content[section]()}</div>
    </>
  );
}
