import { ActivityList } from '@/features/timeline/activity-list';
import { WorkItemIntake } from '@/features/work/work-item-intake';
import { DocumentsSection } from '@/features/documents/section';
import { EditWorkItemSheet } from '@/features/work/edit-work-item-sheet';
import { Hint } from '@/components/controls/inputs';
import type { WorkItemDetailModel } from '@/lib/application/work/work-item-detail';
import { uploadWorkItemDocumentAction } from '@/app/organizations/[organizationId]/work/[workItemId]/actions';
import {
  WorkChecklistSection,
  WorkCostSection,
  WorkIdentity,
  WorkInvoiceSection,
  WorkItemTabs,
  WorkMarginSection,
  WorkOperationalActions,
  WorkQuoteSection,
  WorkRecordHeader,
  WorkRequirementsSection,
  WorkTimeSection,
} from '@/features/work/work-item-sections';

export function WorkItemDetailScreen({ organizationId, organization, model, defaultTab }: { organizationId: string; organization: { timezone: string; currency: string | null; role: string }; model: WorkItemDetailModel; defaultTab?: string }) {
  const { workItem, checklist, timeEntries, costs, definitions, lines, priceBook, customers, locations,
    assets, invoice, statuses, transitions, documents, timeline, price, economics, standing, mayAttach,
    billingEnabled, assetsEnabled, cardsAccepted, resourceOptions, mayEditDetails, needs, coverage, suggestion, intake } = model;
  const workItemId = workItem.id;
  const can = (capability: string) => model.capabilities.has(capability);

  return (
    <>
      <WorkRecordHeader
        organizationId={organizationId}
        workItem={workItem}
        timezone={organization.timezone}
      />
      <WorkItemTabs
        defaultTab={defaultTab}
        overview={
          <>
            <WorkIdentity
              organizationId={organizationId}
              workItem={workItem}
              definitions={definitions}
              assetsEnabled={assetsEnabled}
            />
            <WorkItemIntake organizationId={organizationId} intake={intake} timezone={organization.timezone} />
            {mayEditDetails ? (
              <EditWorkItemSheet
                organizationId={organizationId}
                workItem={workItem}
                customers={customers.map((item) => ({ id: item.id, label: item.name }))}
                locations={locations.map((item) => ({ id: item.id, label: item.label }))}
                assets={assets.map((item) => ({ id: item.id, label: item.name }))}
                assetsEnabled={assetsEnabled}
                definitions={definitions}
              />
            ) : (
              <Hint weight="subtle" className="mt-3">
                Your role cannot correct a job&rsquo;s details here.
              </Hint>
            )}
          </>
        }
        execution={
          <>
            <WorkRequirementsSection
              coverage={coverage}
              suggestion={suggestion}
              organizationId={organizationId}
              workItemId={workItemId}
            />
            <WorkOperationalActions
              organizationId={organizationId}
              timezone={organization.timezone}
              workItem={workItem}
              statuses={statuses}
              transitions={transitions}
              resources={resourceOptions}
              needs={needs}
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
          </>
        }
        financials={
          <>
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
        }
        documents={
          <DocumentsSection
            organizationId={organizationId}
            documents={documents}
            mayAttach={mayAttach}
            roleLabel={organization.role}
            uploadAction={uploadWorkItemDocumentAction}
            hiddenFields={{ organizationId, workItemId }}
            className="mt-0"
          />
        }
        activity={
          // Not capability-gated, deliberately, the same as a customer's: the table is
          // append-only and RLS has already restricted every row to this tenant.
          <ActivityList timeline={timeline} timezone={organization.timezone} />
        }
      />
    </>
  );
}
