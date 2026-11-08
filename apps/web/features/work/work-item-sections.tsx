import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge, DefinitionList, Detail } from '@/components/display/data';
import { Disclosure } from '@/components/surfaces/card';
import { RecordHeader } from '@/components/headers/record-header';
import { RecordSubnavigation } from '@/components/navigation/record-subnavigation';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { BusinessLabel } from '@/lib/context/business-vocabulary';
import { CustomFieldDetails } from '@/features/custom-fields/values';
import { InvoiceDialog } from '@/features/finance/transactions/invoice-dialog';
import { PaymentDialog } from '@/features/finance/transactions/payment-dialog';
import { QuoteDialog } from '@/features/finance/transactions/quote-dialog';
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
import type { Invoice, InvoiceStanding } from '@/lib/domain/billing/invoices';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { AddChecklistItemForm, ChecklistItemControl } from './checklist-forms';
import { RecordCostForm, RecordTimeForm } from './consumption-forms';
import { RemovePricedLineForm } from './pricing-forms';
import { RequestCardPaymentForm } from './billing-forms';
import type { CoverageView, ResourceNeedsView } from '@/lib/domain/work-items/requirements';
import { AssignResourcesForm, AssignSuggestedForm, MoveWorkItemForm, ScheduleWorkItemForm } from './work-operations-forms';
import { WORK_SECTIONS, WORK_SECTION_LABELS, workSectionHref, type WorkSection } from './work-record-sections';

const people = (workItem: WorkItem) => workItem.resources.map(resource => resource.label).join(', ');

/**
 * The record's identity: the workspace bar names it (one heading), and this line says what it is —
 * its type, its current stage and, for scheduled work, when. Edit details is its one record action.
 */
export function WorkRecordHeader({ organizationId, workItem, timezone, actions }: {
  organizationId: string;
  workItem: WorkItem;
  timezone: string;
  actions?: ReactNode;
}) {
  return (
    <RecordHeader
      title={workItem.title}
      crumbs={[
        { label: 'Work', href: `/organizations/${organizationId}/work` },
        { label: workItem.type.label, href: `/organizations/${organizationId}/work?type=${workItem.type.id}` },
        { label: workItem.title },
      ]}
      summary={<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={`/organizations/${organizationId}/work?type=${workItem.type.id}`} className="font-medium text-foreground hover:underline">{workItem.type.label}</Link>
        <Badge>{workItem.status.label}</Badge>
        {workItem.type.schedulable ? <span className="tabular-nums">{workItem.window ? formatWindow(workItem.window, timezone) : 'Not scheduled'}</span> : null}
      </span>}
      actions={actions}
    />
  );
}

/** The five sections as addresses, in the contact record's navigation. */
export function WorkRecordNavigation({ organizationId, workItemId, current }: { organizationId: string; workItemId: string; current: WorkSection }) {
  return <RecordSubnavigation label="Work item sections" current={current}
    sections={WORK_SECTIONS.map(section => ({ key: section, label: WORK_SECTION_LABELS[section], href: workSectionHref(organizationId, workItemId, section) }))} />;
}

/**
 * Who and what the work involves (the header line already says its type, stage and time): who it
 * is for, who is on it (scheduled work only), where, on what, then the business's own fields. Every value links to its own record; a fact the
 * job does not have, or a module the business has off, is left out rather than shown empty.
 */
export function WorkIdentity({ organizationId, workItem, definitions, assetsEnabled }: {
  organizationId: string;
  workItem: WorkItem;
  definitions: FieldDefinition[];
  assetsEnabled: boolean;
}) {
  const base = `/organizations/${organizationId}`;
  return (
    <section aria-label="Work details" className="rounded-[var(--visual-radius,0.625rem)] border border-border bg-surface p-4">
      <DefinitionList>
        <Detail label={<BusinessLabel>Customer</BusinessLabel>}>
          {workItem.customer ? <Link href={`${base}/crm/contacts/${workItem.customer.id}`} className="underline underline-offset-4">{workItem.customer.label}</Link> : <span className="text-muted">None</span>}
        </Detail>
        {workItem.type.schedulable ? (
          <Detail label="Assigned to">
            {workItem.resources.length > 0 ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {workItem.resources.map((resource) => <Link key={resource.id} href={`${base}/resources/${resource.id}`} className="underline underline-offset-4">{resource.label}</Link>)}
              </span>
            ) : <span className="text-muted">Unassigned</span>}
          </Detail>
        ) : null}
        <Detail label="Location">
          {workItem.location ? <Link href={`${base}/locations/${workItem.location.id}`} className="underline underline-offset-4">{workItem.location.label}</Link> : null}
        </Detail>
        {assetsEnabled ? (
          <Detail label="Asset">
            {workItem.asset ? <Link href={`${base}/assets/${workItem.asset.id}`} className="underline underline-offset-4">{workItem.asset.label}</Link> : null}
          </Detail>
        ) : null}
        <CustomFieldDetails definitions={definitions} custom={workItem.custom} />
      </DefinitionList>
    </section>
  );
}

/**
 * What to do next, first: the moves this type's workflow allows from the current stage, then —
 * for scheduled work only — when it happens and who does it, each change behind its own
 * disclosure so only the one being made is open. Nothing here is drawn for someone who may do none of it.
 */
export function WorkOperationalActions({
  organizationId, timezone,
  workItem,
  statuses,
  transitions,
  resources,
  needs,
  mayMove,
  maySchedule,
}: {
  organizationId: string; timezone: string;
  workItem: WorkItem;
  statuses: WorkItemStatus[];
  transitions: WorkItemTransition[];
  resources: { id: string; label: string }[];
  needs?: ResourceNeedsView | null;
  mayMove: boolean;
  maySchedule: boolean;
}) {
  const scheduling = maySchedule && workItem.type.schedulable;
  if (!mayMove && !scheduling) return null;

  const statusNames = new Map(statuses.map((status) => [status.id, status.name]));
  const moves = mayMove
    ? allowedNextStatusIds(transitions, workItem.status.id).flatMap((id) => {
        const name = statusNames.get(id);
        return name ? [{ id, name }] : [];
      })
    : [];

  return (
    <Section className="border-t-0 pt-0" aria-labelledby="work-actions-heading">
      <SectionHeading id="work-actions-heading">Next actions</SectionHeading>
      {mayMove ? <div className="mt-3">
        <p className="mb-2 text-sm text-muted">Now in <span className="font-medium text-foreground">{workItem.status.label}</span>.{moves.length ? '' : ' No stage moves are set up from here.'}</p>
        <MoveWorkItemForm organizationId={organizationId} workItemId={workItem.id} moves={moves} />
      </div> : null}
      {scheduling ? (
        <div className="mt-5 flex flex-col gap-3">
          <p className="text-sm"><span className="text-muted">Schedule: </span><span className="tabular-nums">{workItem.window ? formatWindow(workItem.window, timezone) : 'Not scheduled'}</span><span className="text-muted"> · </span>{people(workItem) || 'Unassigned'}</p>
          <Disclosure summary={workItem.window ? 'Change schedule' : 'Schedule this work'} className="max-w-2xl">
            <ScheduleWorkItemForm
              organizationId={organizationId}
              workItemId={workItem.id}
              resources={resources}
              assigned={workItem.resources.map((resource) => resource.id)}
              needs={needs}
              scheduled={workItem.window !== null}
              window={workItem.window}
              timezone={timezone}
            />
          </Disclosure>
          <Disclosure summary="Change who is on this" className="max-w-2xl">
            <AssignResourcesForm
              organizationId={organizationId}
              workItemId={workItem.id}
              resources={resources}
              assigned={workItem.resources.map((resource) => resource.id)}
              needs={needs}
            />
          </Disclosure>
        </div>
      ) : null}
    </Section>
  );
}

/**
 * What this job needs against who is on it — derived, never stored. A short job is still a perfectly
 * good job: it stays scheduled and visible, and this says plainly what is missing. Words carry the
 * state (a mark is decoration), so it reads the same without colour or sight. A suggestion is
 * offered, never applied.
 */
export function WorkRequirementsSection({
  coverage,
  suggestion = null,
  organizationId,
  workItemId,
}: {
  coverage: CoverageView | null;
  /** A complete set that is free at the job's own time, when it is short and one exists. Offered, never applied. */
  suggestion?: { names: string[]; resourceIds: string[] } | null;
  organizationId?: string;
  workItemId?: string;
}) {
  if (!coverage || coverage.lines.length === 0) return null;

  return (
    <Section className="mt-8" aria-labelledby="work-needs-heading">
      <SectionHeading id="work-needs-heading">Resources needed</SectionHeading>
      <p className="mt-1 text-sm" role="status">
        {coverage.satisfied ? 'Everything this kind of work needs is assigned.' : `Not fully staffed — ${coverage.shortfall}.`}
      </p>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {coverage.lines.map((line) => (
          <li key={line.requirementId} className="flex items-baseline gap-2">
            <span aria-hidden className={line.met ? 'text-muted' : 'font-medium'}>
              {line.met ? '✓' : '!'}
            </span>
            <span>
              <span className="sr-only">{line.met ? 'Met: ' : 'Missing: '}</span>
              {line.text}
            </span>
          </li>
        ))}
      </ul>
      {coverage.extra.length > 0 ? (
        <p className="mt-1 text-sm text-muted">Also assigned: {coverage.extra.join(', ')}.</p>
      ) : null}
      {suggestion && organizationId && workItemId ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm">
            <span className="text-muted">Available at this time: </span>
            {suggestion.names.join(', ')}
          </p>
          <AssignSuggestedForm organizationId={organizationId} workItemId={workItemId} resourceIds={suggestion.resourceIds} />
        </div>
      ) : null}
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
  const done = checklist.filter(item => item.doneAt !== null).length;
  return (
    <Section className="mt-8" aria-labelledby="work-steps-heading"><SectionHeading id="work-steps-heading">Steps{checklist.length ? <span className="ml-2 text-sm font-normal text-muted tabular-nums">{done} of {checklist.length} done</span> : null}</SectionHeading>
      {checklist.length === 0 ? <EmptyState weight="subtle" className="mt-1">None yet.</EmptyState> : <ul aria-label="Steps" className="mt-3 flex flex-col gap-3">{checklist.map((item) => <li key={item.id}>{mayTick ? <ChecklistItemControl organizationId={organizationId} workItemId={workItemId} checklistItemId={item.id} label={item.label} done={item.doneAt !== null} /> : <span className={item.doneAt ? 'text-sm line-through text-subtle' : 'text-sm'}><span aria-hidden>{item.doneAt ? '☑' : '☐'}</span> {item.label}</span>}</li>)}</ul>}
      {mayAdd ? <Disclosure summary="Add a step" className="mt-3 max-w-2xl"><AddChecklistItemForm organizationId={organizationId} workItemId={workItemId} position={nextPosition} /></Disclosure> : null}
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
  return <Section className="mt-8" aria-labelledby="work-time-heading"><SectionHeading id="work-time-heading">Time worked</SectionHeading>{timeEntries.length === 0 ? <EmptyState weight="subtle" className="mt-1">None recorded.</EmptyState> : <DividedList className="mt-2">{timeEntries.map((entry) => <li key={entry.id} className="py-2 text-sm"><div>{formatWindow(entry.worked, timezone)}</div><div className="text-muted">{[entry.resourceId ? names.get(entry.resourceId) : null, entry.note].filter(Boolean).join(' · ')}</div></li>)}</DividedList>}{mayRecord ? <Disclosure summary="Record time" className="mt-3 max-w-3xl"><RecordTimeForm organizationId={organizationId} workItemId={workItemId} resources={resources} /></Disclosure> : null}</Section>;
}

/**
 * This job's priced lines, as snapshotted when each was added. Adding one opens Finance's own quote
 * dialog with this job chosen, so there is one way to price work; removing stays here, confirmed.
 */
export function WorkQuoteSection({ organizationId, workItemId, lines, price, priceBookCount, mayPrice, mayManageCatalog }: {
  organizationId: string;
  workItemId: string;
  lines: PricedLine[];
  price: Price;
  priceBookCount: number;
  mayPrice: boolean;
  mayManageCatalog: boolean;
}) {
  return <Section className="border-t-0 pt-0" aria-labelledby="work-quote-heading">
    <div className="flex flex-wrap items-center justify-between gap-2"><SectionHeading id="work-quote-heading">Quote</SectionHeading>{mayPrice && priceBookCount > 0 ? <QuoteDialog organizationId={organizationId} workItemId={workItemId} label="Add priced line" size="small" mayManageCatalog={mayManageCatalog} /> : null}</div>
    {lines.length === 0 ? <EmptyState weight="subtle" className="mt-1">Nothing priced.</EmptyState> : <DividedList className="mt-2">{lines.map((line) => <li key={line.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between"><span>{line.description}<span className="text-subtle"> × {line.quantity} {line.unit}</span></span><span className="flex items-baseline gap-3"><span className="tabular-nums text-muted">{formatMoney(line.unitAmountMinor * line.quantity, line.currency)}</span>{mayPrice ? <RemovePricedLineForm organizationId={organizationId} workItemId={workItemId} lineId={line.id} description={line.description} /> : null}</span></li>)}</DividedList>}
    {price ? <p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>Total</span><span className="tabular-nums">{formatMoney(price.totalMinor, price.currency)}</span></p> : null}
    {mayPrice && priceBookCount === 0 ? <Hint className="mt-3">Nothing is priced in this business yet. {mayManageCatalog ? <Link className="underline underline-offset-4" href={`/organizations/${organizationId}/finance/catalog`}>Set up pricing</Link> : null}</Hint> : null}
  </Section>;
}

export function WorkCostSection({ organizationId, workItemId, costs, economics, currency, mayRecord }: {
  organizationId: string;
  workItemId: string;
  costs: Cost[];
  economics: JobEconomics;
  currency: string | null;
  mayRecord: boolean;
}) {
  return <Section className="mt-8" aria-labelledby="work-cost-heading"><SectionHeading id="work-cost-heading">Recorded costs</SectionHeading>{costs.length === 0 ? <EmptyState weight="subtle" className="mt-1">No costs recorded.</EmptyState> : <DividedList className="mt-2">{costs.map((cost) => <li key={cost.id} className="flex justify-between gap-3 py-2 text-sm"><span>{cost.description}</span><span className="shrink-0 tabular-nums text-muted">{formatMoney(cost.amountMinor, cost.currency)}</span></li>)}</DividedList>}{economics.costs.length > 0 ? <p className="mt-2 flex flex-wrap justify-between gap-3 text-sm font-medium"><span>Total</span><span className="tabular-nums">{economics.costs.map((cost) => formatMoney(cost.amountMinor, cost.currency)).join(' + ')}</span></p> : null}{mayRecord ? currency === null ? <Hint className="mt-4">Costs use this business&rsquo;s trading currency, which is not set yet.</Hint> : <Disclosure summary="Record a cost" className="mt-3 max-w-3xl"><RecordCostForm organizationId={organizationId} workItemId={workItemId} currency={currency} /></Disclosure> : null}</Section>;
}

/**
 * The invoice exactly as issued, its payments and corrections, and what is still owed. Issuing an
 * invoice and recording a payment open Finance's own dialogs with this job chosen.
 */
export function WorkInvoiceSection({ organizationId, workItemId, invoice, standing, price, timezone, today, cardsAccepted, mayInvoice, mayBePaid }: {
  organizationId: string;
  workItemId: string;
  invoice: Invoice | null;
  standing: InvoiceStanding | null;
  price: Price;
  timezone: string;
  today: string;
  cardsAccepted: boolean;
  mayInvoice: boolean;
  mayBePaid: boolean;
}) {
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { timeZone: timezone });
  const action = invoice && standing ? (mayBePaid && !standing.settled ? <PaymentDialog organizationId={organizationId} invoiceId={invoice.id} today={today} size="small" /> : null)
    : mayInvoice && price ? <InvoiceDialog organizationId={organizationId} workItemId={workItemId} today={today} label="Issue invoice" size="small" /> : null;
  return <Section className="mt-8" aria-labelledby="work-invoice-heading">
    <div className="flex flex-wrap items-center justify-between gap-2"><SectionHeading id="work-invoice-heading">Invoice</SectionHeading>{action}</div>
    {invoice && standing ? <>
      <Hint className="mt-1">#{invoice.number} to {invoice.billedTo} · issued {date(invoice.issuedAt)}{invoice.dueAt ? ` · due ${date(invoice.dueAt)}` : null}</Hint>
      <DividedList className="mt-2">{invoice.lines.map((line) => <li key={line.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between"><span>{line.description}<span className="text-subtle"> × {line.quantity} {line.unit}</span></span><span className="shrink-0 tabular-nums text-muted">{formatMoney(line.unitAmountMinor * line.quantity, line.currency)}</span></li>)}</DividedList>
      {standing.total ? <p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>Invoiced</span><span className="tabular-nums">{formatMoney(standing.total.totalMinor, standing.total.currency)}</span></p> : null}
      {invoice.payments.length > 0 ? <><h3 className="mt-4 text-sm font-medium">Payments</h3><DividedList className="mt-1">{invoice.payments.map((payment) => <li key={payment.id} className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:justify-between"><span className="text-muted">{date(payment.receivedAt)}{payment.provider ? ` · ${payment.provider === 'stripe' ? 'Stripe' : 'card payment'}` : ' · recorded by hand'}{payment.note ? ` · ${payment.note}` : null}</span><span className={`shrink-0 tabular-nums ${payment.amountMinor < 0 ? 'text-danger' : ''}`}>{formatMoney(payment.amountMinor, payment.currency)}</span></li>)}</DividedList></> : null}
      <p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>{standing.settled ? 'Settled' : 'Outstanding'}</span><span className="tabular-nums">{standing.outstandingMinor === null ? '—' : formatMoney(standing.outstandingMinor, invoice.currency)}</span></p>
      {mayBePaid && cardsAccepted && !standing.settled ? <RequestCardPaymentForm organizationId={organizationId} workItemId={workItemId} /> : null}
    </> : <Hint weight="subtle" className="mt-1">{price ? 'Not invoiced yet.' : 'There is nothing priced on this job, so there is nothing to invoice.'}</Hint>}
  </Section>;
}

/**
 * A margin only where it means something: priced work with recorded costs in the same currency.
 * With no cost recorded the difference would be the whole price, which is not a measured margin,
 * so it is not shown as one.
 */
export function WorkMarginSection({ economics }: { economics: JobEconomics }) {
  const measured = economics.marginMinor !== null && economics.currency !== null && economics.costs.length > 0;
  return <Section className="mt-8" aria-labelledby="work-margin-heading"><SectionHeading id="work-margin-heading">Margin</SectionHeading>{measured ? <p className="mt-2 flex justify-between gap-3 text-sm font-medium"><span>{economics.marginMinor! < 0 ? 'Loss on this job' : 'Margin on this job'}</span><span className="tabular-nums">{formatMoney(economics.marginMinor!, economics.currency!)}</span></p> : <Hint weight="subtle" className="mt-1">{economics.revenue === null ? 'Nothing is priced on this job yet, so there is nothing to compare its costs against.' : economics.costs.length === 0 ? 'No costs are recorded on this job, so no margin is shown.' : 'This job is priced in one currency and its costs are recorded in another, so there is no single margin. The two totals are above.'}</Hint>}</Section>;
}
