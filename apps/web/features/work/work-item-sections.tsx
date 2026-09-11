import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { Disclosure } from '@/components/containers/card';
import { RecordHeader } from '@/components/containers/record-header';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { CustomFieldValues } from '@/features/custom-fields/values';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { ChecklistItem } from '@/lib/domain/work-items/checklists';
import type { Cost, TimeEntry } from '@/lib/domain/work-items/consumption';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import type { JobEconomics } from '@/lib/domain/work-items/economics';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  allowedNextStatusIds,
  type WorkItemTransition,
} from '@/lib/domain/work-items/transitions';
import type { PricedLine, Price } from '@/lib/domain/pricing/prices';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { Invoice, InvoiceStanding } from '@/lib/domain/billing/invoices';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { AddChecklistItemForm, ChecklistItemControl } from './checklist-forms';
import { EditWorkItemForm } from './details-form';
import { RecordCostForm, RecordTimeForm } from './consumption-forms';
import { AddPricedLineForm, RemovePricedLineForm } from './pricing-forms';
import { IssueInvoiceForm, RecordPaymentForm, RequestCardPaymentForm } from './billing-forms';
import { MoveWorkItemForm, ScheduleWorkItemForm } from './work-operations-forms';

export function WorkRecordHeader({ organizationId, workItem, timezone }: {
  organizationId: string;
  workItem: WorkItem;
  timezone: string;
}) {
  return (
    <RecordHeader
      title={workItem.title}
      crumbs={[
        { label: 'Work', href: `/organizations/${organizationId}/work` },
        { label: workItem.type.label, href: `/organizations/${organizationId}/work?type=${workItem.type.id}` },
        { label: workItem.title },
      ]}
      summary={workItem.window ? <span className="tabular-nums">{formatWindow(workItem.window, timezone)}</span> : 'Not scheduled'}
    />
  );
}

export function WorkIdentity({ workItem, definitions, assetsEnabled }: {
  workItem: WorkItem;
  definitions: FieldDefinition[];
  assetsEnabled: boolean;
}) {
  return (
    <section aria-label="Job overview" className="mt-5 rounded border border-border p-4">
      <DefinitionList>
        <Detail label="Stage"><Badge>{workItem.status.label}</Badge></Detail>
        <Detail label="Customer">{workItem.customer?.label}</Detail>
        <Detail label="Assigned to">{workItem.resource?.label}</Detail>
        <Detail label="Location">{workItem.location?.label}</Detail>
        {assetsEnabled ? <Detail label="Asset">{workItem.asset?.label}</Detail> : null}
      </DefinitionList>
      <CustomFieldValues definitions={definitions} custom={workItem.custom} />
    </section>
  );
}

/** The actions that move the job forward stay together, immediately after its identity. */
export function WorkOperationalActions({
  organizationId,
  workItem,
  statuses,
  transitions,
  resources,
  mayMove,
  maySchedule,
}: {
  organizationId: string;
  workItem: WorkItem;
  statuses: WorkItemStatus[];
  transitions: WorkItemTransition[];
  resources: { id: string; label: string }[];
  mayMove: boolean;
  maySchedule: boolean;
}) {
  if (!mayMove && !maySchedule) return null;

  const statusNames = new Map(statuses.map((status) => [status.id, status.name]));
  const moves = mayMove
    ? allowedNextStatusIds(transitions, workItem.status.id).flatMap((id) => {
        const name = statusNames.get(id);
        return name ? [{ id, name }] : [];
      })
    : [];

  return (
    <Section className="mt-8" aria-labelledby="work-actions-heading">
      <SectionHeading id="work-actions-heading">Next actions</SectionHeading>
      {moves.length > 0 ? (
        <div className="mt-3">
          <MoveWorkItemForm
            organizationId={organizationId}
            workItemId={workItem.id}
            moves={moves}
          />
        </div>
      ) : mayMove ? (
        <Hint weight="subtle" className="mt-1">
          No stage moves are available from {workItem.status.label}.
        </Hint>
      ) : null}
      {maySchedule ? (
        <Disclosure
          summary={workItem.window ? 'Change schedule' : 'Schedule this work'}
          className="mt-3 max-w-2xl"
        >
          <ScheduleWorkItemForm
            organizationId={organizationId}
            workItemId={workItem.id}
            resources={resources}
            scheduled={workItem.window !== null}
          />
        </Disclosure>
      ) : null}
    </Section>
  );
}

export function WorkDetailsSection({ organizationId, workItem, customers, locations, assets, assetsEnabled, definitions, mayEdit }: {
  organizationId: string;
  workItem: WorkItem;
  customers: { id: string; label: string }[];
  locations: { id: string; label: string }[];
  assets: { id: string; label: string }[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
  mayEdit: boolean;
}) {
  return (
    <Section className="mt-8">
      <SectionHeading>Job details</SectionHeading>
      {mayEdit ? (
        <Disclosure summary="Correct job details" className="mt-3">
          <EditWorkItemForm
            organizationId={organizationId}
            workItem={workItem}
            customers={customers}
            locations={locations}
            assets={assets}
            assetsEnabled={assetsEnabled}
            definitions={definitions}
          />
        </Disclosure>
      ) : (
        <Hint weight="subtle" className="mt-1">
          Your role cannot correct a job&rsquo;s details here.
        </Hint>
      )}
    </Section>
  );
}

export function WorkChecklistSection({ organizationId, workItemId, checklist, mayTick, mayAdd }: {
  organizationId: string;
  workItemId: string;
  checklist: ChecklistItem[];
  mayTick: boolean;
  mayAdd: boolean;
}) {
  const nextPosition = checklist.reduce((highest, item) => Math.max(highest, item.position), -1) + 1;
  return (
    <Section className="mt-8"><SectionHeading>Steps</SectionHeading>
      {checklist.length === 0 ? <EmptyState weight="subtle" className="mt-1">None yet.</EmptyState> : <ul className="mt-3 flex flex-col gap-3">{checklist.map((item) => <li key={item.id}>{mayTick ? <ChecklistItemControl organizationId={organizationId} workItemId={workItemId} checklistItemId={item.id} label={item.label} done={item.doneAt !== null} /> : <span className={item.doneAt ? 'text-sm line-through text-subtle' : 'text-sm'}><span aria-hidden>{item.doneAt ? '☑' : '☐'}</span> {item.label}</span>}</li>)}</ul>}
      {mayAdd ? <AddChecklistItemForm organizationId={organizationId} workItemId={workItemId} position={nextPosition} /> : null}
    </Section>
  );
}

export function WorkTimeSection({ organizationId, workItemId, timeEntries, resources, timezone, mayRecord }: {
  organizationId: string;
  workItemId: string;
  timeEntries: TimeEntry[];
  resources: { id: string; label: string }[];
  timezone: string;
  mayRecord: boolean;
}) {
  const names = new Map(resources.map((resource) => [resource.id, resource.label]));
  return <Section className="mt-8"><SectionHeading>Time worked</SectionHeading>{timeEntries.length === 0 ? <EmptyState weight="subtle" className="mt-1">None recorded.</EmptyState> : <DividedList className="mt-2">{timeEntries.map((entry) => <li key={entry.id} className="py-2 text-sm"><div>{formatWindow(entry.worked, timezone)}</div><div className="text-muted">{[entry.resourceId ? names.get(entry.resourceId) : null, entry.note].filter(Boolean).join(' · ')}</div></li>)}</DividedList>}{mayRecord ? <RecordTimeForm organizationId={organizationId} workItemId={workItemId} resources={resources} /> : null}</Section>;
}

export function WorkQuoteSection({ organizationId, workItemId, lines, price, priceBook, mayPrice }: {
  organizationId: string;
  workItemId: string;
  lines: PricedLine[];
  price: Price;
  priceBook: PriceBookItem[];
  mayPrice: boolean;
}) {
  return <Section className="mt-8"><SectionHeading>Quote</SectionHeading>{lines.length === 0 ? <EmptyState weight="subtle" className="mt-1">Nothing priced.</EmptyState> : <DividedList className="mt-2">{lines.map((line) => <li key={line.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between"><span>{line.description}<span className="text-subtle"> × {line.quantity} {line.unit}</span></span><span className="flex items-baseline gap-3"><span className="text-muted">{formatMoney(line.unitAmountMinor * line.quantity, line.currency)}</span>{mayPrice ? <RemovePricedLineForm organizationId={organizationId} workItemId={workItemId} lineId={line.id} description={line.description} /> : null}</span></li>)}</DividedList>}{price ? <p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>Total</span><span>{formatMoney(price.totalMinor, price.currency)}</span></p> : null}{mayPrice && priceBook.length === 0 ? <EmptyState className="mt-3">Nothing is priced in this business yet, so there is nothing to quote from.</EmptyState> : null}{mayPrice && priceBook.length > 0 ? <AddPricedLineForm organizationId={organizationId} workItemId={workItemId} items={priceBook} /> : null}</Section>;
}

export function WorkCostSection({ organizationId, workItemId, costs, economics, currency, mayRecord }: {
  organizationId: string;
  workItemId: string;
  costs: Cost[];
  economics: JobEconomics;
  currency: string | null;
  mayRecord: boolean;
}) {
  return <Section className="mt-8"><SectionHeading>Cost</SectionHeading>{costs.length === 0 ? <EmptyState weight="subtle" className="mt-1">Nothing recorded.</EmptyState> : <DividedList className="mt-2">{costs.map((cost) => <li key={cost.id} className="flex justify-between gap-3 py-2 text-sm"><span>{cost.description}</span><span className="shrink-0 text-muted">{formatMoney(cost.amountMinor, cost.currency)}</span></li>)}</DividedList>}{economics.costs.length > 0 ? <p className="mt-2 flex flex-wrap justify-between gap-3 text-sm font-medium"><span>Total</span><span>{economics.costs.map((cost) => formatMoney(cost.amountMinor, cost.currency)).join(' + ')}</span></p> : null}{mayRecord ? currency === null ? <Hint className="mt-4">Costs use this business&rsquo;s currency. Set it on the pricing screen before recording a cost.</Hint> : <RecordCostForm organizationId={organizationId} workItemId={workItemId} currency={currency} /> : null}</Section>;
}

export function WorkInvoiceSection({ organizationId, workItemId, invoice, standing, price, timezone, cardsAccepted, mayInvoice, mayBePaid }: {
  organizationId: string;
  workItemId: string;
  invoice: Invoice | null;
  standing: InvoiceStanding | null;
  price: Price;
  timezone: string;
  cardsAccepted: boolean;
  mayInvoice: boolean;
  mayBePaid: boolean;
}) {
  return <Section className="mt-8"><SectionHeading>Invoice</SectionHeading>{invoice && standing ? <><Hint className="mt-1">#{invoice.number} to {invoice.billedTo} · {new Date(invoice.issuedAt).toLocaleDateString('en-GB', { timeZone: timezone })}{invoice.dueAt ? ` · due ${new Date(invoice.dueAt).toLocaleDateString('en-GB', { timeZone: timezone })}` : null}</Hint><DividedList className="mt-2">{invoice.lines.map((line) => <li key={line.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between"><span>{line.description}<span className="text-subtle"> × {line.quantity} {line.unit}</span></span><span className="shrink-0 text-muted">{formatMoney(line.unitAmountMinor * line.quantity, line.currency)}</span></li>)}</DividedList>{standing.total ? <p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>Invoiced</span><span className="tabular-nums">{formatMoney(standing.total.totalMinor, standing.total.currency)}</span></p> : null}{invoice.payments.length > 0 ? <DividedList className="mt-3">{invoice.payments.map((payment) => <li key={payment.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:justify-between"><span className="text-muted">{new Date(payment.receivedAt).toLocaleDateString('en-GB', { timeZone: timezone })}{payment.provider ? ` · ${payment.provider}` : ' · recorded by hand'}{payment.note ? ` · ${payment.note}` : null}</span><span className="shrink-0 tabular-nums">{formatMoney(payment.amountMinor, payment.currency)}</span></li>)}</DividedList> : null}<p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>{standing.settled ? 'Settled' : 'Outstanding'}</span><span className="tabular-nums">{standing.outstandingMinor === null ? '—' : formatMoney(standing.outstandingMinor, invoice.currency)}</span></p>{mayBePaid && cardsAccepted && !standing.settled ? <RequestCardPaymentForm organizationId={organizationId} workItemId={workItemId} /> : null}{mayBePaid ? <RecordPaymentForm organizationId={organizationId} workItemId={workItemId} invoiceId={invoice.id} currency={invoice.currency} /> : <Hint weight="subtle" className="mt-3">Your role cannot record payments here.</Hint>}</> : <><Hint weight="subtle" className="mt-1">{price ? 'Not invoiced yet.' : 'There is nothing priced on this job, so there is nothing to invoice.'}</Hint>{mayInvoice && price ? <IssueInvoiceForm organizationId={organizationId} workItemId={workItemId} /> : null}{!mayInvoice ? <Hint weight="subtle" className="mt-3">Your role cannot issue invoices here.</Hint> : null}</>}</Section>;
}

export function WorkMarginSection({ economics }: { economics: JobEconomics }) {
  return <Section className="mt-8"><SectionHeading>Margin</SectionHeading>{economics.marginMinor !== null && economics.currency ? <p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>{economics.marginMinor < 0 ? 'Loss on this job' : 'Margin on this job'}</span><span className="tabular-nums">{formatMoney(economics.marginMinor, economics.currency)}</span></p> : <Hint weight="subtle" className="mt-1">{economics.revenue === null ? 'Nothing is priced on this job yet, so there is nothing to compare its costs against.' : 'This job is priced in one currency and its costs are recorded in another, so there is no single margin. The two totals are above.'}</Hint>}</Section>;
}
