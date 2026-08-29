import Link from 'next/link';
import { notFound } from 'next/navigation';
import { paymentProvider } from '@/lib/adapters/payments';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';
import { CustomFieldValues } from '@/components/custom-field-values';
import { listAssets } from '@/lib/domain/assets/assets';
import { getInvoiceForWorkItem, invoiceStanding } from '@/lib/domain/billing/invoices';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { listResources } from '@/lib/domain/resources/resources';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { listChecklistItems } from '@/lib/domain/work-items/checklists';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { formatMoney, listCosts, listTimeEntries } from '@/lib/domain/work-items/consumption';
import { jobEconomics } from '@/lib/domain/work-items/economics';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { requireOrganization } from '@/lib/route/organization';
import {
  AddChecklistItemForm,
  AddPricedLineForm,
  EditWorkItemForm,
  IssueInvoiceForm,
  RecordCostForm,
  RecordPaymentForm,
  RecordTimeForm,
  RequestCardPaymentForm,
  RemovePricedLineForm,
  ToggleChecklistItemForm,
} from './work-item-forms';

export const dynamic = 'force-dynamic';

/** One job: what it involves, what it took, and what it cost. */
export default async function WorkItemPage({
  params,
}: PageProps<'/organizations/[organizationId]/work/[workItemId]'>) {
  const { organizationId, workItemId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const workItems = await listWorkItems(db, { organizationId });
  const workItem = workItems.find((item) => item.id === workItemId);
  // Absent rather than forbidden: RLS has already decided, and from here a work item in
  // another tenant genuinely does not exist.
  if (!workItem) {
    notFound();
  }

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
    listEnabledModules(db, { organizationId }),
  ]);

  // I4: the only total on this page, and the only one anywhere. Nothing here reduces an
  // array, and nothing writes a subtotal to a column that could later disagree with it.
  const price = priceWorkItem(lines);
  // Revenue minus cost. It calls `priceWorkItem` rather than totalling anything itself, so
  // this page still has exactly one price calculation on it (I4).
  const economics = jobEconomics({ lines, costs });
  const mayPrice = organization.capabilities.includes('work_item.price');
  // Where the invoice stands, derived on every read. There is no `paid` column to disagree
  // with this, and the total inside it comes from `priceWorkItem` over the invoice's own
  // snapshotted lines — so this page holds two documents and still one calculation (I4).
  const standing = invoice ? invoiceStanding(invoice) : null;
  const mayInvoice = organization.capabilities.includes('invoice.issue');
  const mayBePaid = organization.capabilities.includes('payment.record');
  // Whether this business can take a card: a processor configured on this deployment *and*
  // the module switched on. A business that takes only cash is a complete business, so the
  // control is simply absent rather than disabled with an explanation.
  const cardsAccepted =
    (await paymentProvider()) !== null && enabledModules.has('card_payments');

  const mayAdd = organization.capabilities.includes('work_item.create');
  const mayEdit = organization.capabilities.includes('work_item.update');
  const mayTick = organization.capabilities.includes('work_item.transition');
  const mayRecord = organization.capabilities.includes('work_item.record');

  const resourceName = new Map(resources.map((resource) => [resource.id, resource.name]));
  const nextPosition = checklist.reduce((highest, item) => Math.max(highest, item.position), -1) + 1;

  return (
    <>
      <Link
        href={`/organizations/${organizationId}/work?type=${workItem.type.id}`}
        className="text-sm underline underline-offset-4 opacity-70"
      >
        ← {workItem.type.label}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{workItem.title}</h1>
      <p className="text-sm opacity-70">
        {[
          workItem.status.label,
          workItem.customer?.label,
          workItem.location?.label,
          workItem.asset?.label,
          workItem.resource ? `→ ${workItem.resource.label}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {workItem.window ? (
        <p className="text-sm opacity-70">
          Scheduled {formatWindow(workItem.window, organization.timezone)}
        </p>
      ) : null}
      <CustomFieldValues definitions={definitions} custom={workItem.custom} />

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Details</h2>
        {mayEdit ? (
          <EditWorkItemForm
            organizationId={organizationId}
            workItem={workItem}
            customers={customers.map((customer) => ({ id: customer.id, label: customer.name }))}
            locations={locations.map((location) => ({ id: location.id, label: location.label }))}
            assets={assets.map((asset) => ({ id: asset.id, label: asset.name }))}
            definitions={definitions}
          />
        ) : (
          <p className="mt-1 text-sm opacity-60">
            Your role cannot correct a job&rsquo;s details here.
          </p>
        )}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Steps</h2>

        {checklist.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">None yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {checklist.map((item) => (
              <li key={item.id}>
                {mayTick ? (
                  <ToggleChecklistItemForm
                    organizationId={organizationId}
                    workItemId={workItemId}
                    checklistItemId={item.id}
                    label={item.label}
                    done={item.doneAt !== null}
                  />
                ) : (
                  <span className={item.doneAt ? 'text-sm line-through opacity-60' : 'text-sm'}>
                    {item.doneAt ? '☑' : '☐'} {item.label}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {mayAdd ? (
          <AddChecklistItemForm
            organizationId={organizationId}
            workItemId={workItemId}
            position={nextPosition}
          />
        ) : null}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Time worked</h2>
        {/* Not the same as the scheduled window above, and shown separately on purpose: the
            difference between planned and actual is the reporting value, and a screen that
            merged them would destroy it. */}

        {timeEntries.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">None recorded.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {timeEntries.map((entry) => (
              <li key={entry.id} className="py-2 text-sm">
                <div>{formatWindow(entry.worked, organization.timezone)}</div>
                <div className="opacity-70">
                  {[
                    entry.resourceId ? resourceName.get(entry.resourceId) : null,
                    entry.note,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </li>
            ))}
          </ul>
        )}

        {mayRecord ? (
          <RecordTimeForm
            organizationId={organizationId}
            workItemId={workItemId}
            resources={resources.map((resource) => ({ id: resource.id, label: resource.name }))}
          />
        ) : null}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Quote</h2>
        {/* A quote is what this job is charged; the Cost section below is what it consumed.
            They are deliberately not the same number and are never derived from each other
            — see `roadmap.md` M2 on why a cost is not a price. */}

        {lines.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">Nothing priced.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {lines.map((line) => (
              <li key={line.id} className="flex items-baseline justify-between gap-3 py-2 text-sm">
                <span>
                  {line.description}
                  <span className="opacity-60">
                    {' '}
                    × {line.quantity} {line.unit}
                  </span>
                </span>
                <span className="flex shrink-0 items-baseline gap-3">
                  {/* The line's own snapshotted amount and currency. Re-pricing the
                      catalogue does not reach this row (I8). */}
                  <span className="opacity-70">
                    {formatMoney(line.unitAmountMinor * line.quantity, line.currency)}
                  </span>
                  {mayPrice ? (
                    <RemovePricedLineForm
                      organizationId={organizationId}
                      workItemId={workItemId}
                      lineId={line.id}
                      description={line.description}
                    />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {price ? (
          <p className="mt-2 flex justify-between text-sm font-medium">
            <span>Total</span>
            <span>{formatMoney(price.totalMinor, price.currency)}</span>
          </p>
        ) : null}

        {mayPrice && priceBook.length === 0 ? (
          <p className="mt-3 text-sm opacity-70">
            Nothing is priced in this business yet, so there is nothing to quote from.
          </p>
        ) : null}
        {mayPrice && priceBook.length > 0 ? (
          <AddPricedLineForm
            organizationId={organizationId}
            workItemId={workItemId}
            items={priceBook}
          />
        ) : null}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Cost</h2>

        {costs.length === 0 ? (
          <p className="mt-1 text-sm opacity-60">Nothing recorded.</p>
        ) : (
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {costs.map((cost) => (
              <li key={cost.id} className="flex justify-between py-2 text-sm">
                <span>{cost.description}</span>
                {/* Each row renders in the currency it was recorded in, not the
                    organization's current one — a business that changed currency did not
                    change what last year's jobs cost (I8). */}
                <span className="opacity-70">
                  {formatMoney(cost.amountMinor, cost.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {economics.costs.length > 0 ? (
          <p className="mt-2 flex flex-wrap justify-between gap-x-3 text-sm font-medium">
            <span>Total</span>
            {/* One line per currency. A job whose costs are in two currencies has no single
                total, and printing one would require a rate — which has a date, which makes
                this accounting software (`vision.md`). */}
            <span>
              {economics.costs
                .map((cost) => formatMoney(cost.amountMinor, cost.currency))
                .join(' + ')}
            </span>
          </p>
        ) : null}

        {mayRecord ? (
          <RecordCostForm
            organizationId={organizationId}
            workItemId={workItemId}
            currency={organization.currency}
          />
        ) : null}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Invoice</h2>
        {/* The quote above can still change after this is issued. That is the point of the
            invoice being a copy rather than a view — it is what somebody was sent (I8). */}

        {invoice && standing ? (
          <>
            <p className="mt-1 text-sm opacity-70">
              #{invoice.number} to {invoice.billedTo} ·{' '}
              {new Date(invoice.issuedAt).toLocaleDateString('en-GB', {
                timeZone: organization.timezone,
              })}
              {invoice.dueAt
                ? ` · due ${new Date(invoice.dueAt).toLocaleDateString('en-GB', {
                    timeZone: organization.timezone,
                  })}`
                : null}
            </p>

            <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
              {invoice.lines.map((line) => (
                <li
                  key={line.id}
                  className="flex items-baseline justify-between gap-3 py-2 text-sm"
                >
                  <span>
                    {line.description}
                    <span className="opacity-60">
                      {' '}
                      × {line.quantity} {line.unit}
                    </span>
                  </span>
                  {/* No remove control, and no edit. There is no update or delete policy on
                      `invoice_lines` at all: this document has been sent. */}
                  <span className="shrink-0 opacity-70">
                    {formatMoney(line.unitAmountMinor * line.quantity, line.currency)}
                  </span>
                </li>
              ))}
            </ul>

            {standing.total ? (
              <p className="mt-2 flex justify-between text-sm font-medium">
                <span>Invoiced</span>
                <span className="tabular-nums">
                  {formatMoney(standing.total.totalMinor, standing.total.currency)}
                </span>
              </p>
            ) : null}

            {invoice.payments.length > 0 ? (
              <ul className="mt-3 divide-y divide-black/10 dark:divide-white/15">
                {invoice.payments.map((payment) => (
                  <li key={payment.id} className="flex justify-between gap-3 py-2 text-sm">
                    <span className="opacity-70">
                      {new Date(payment.receivedAt).toLocaleDateString('en-GB', {
                        timeZone: organization.timezone,
                      })}
                      {/* A payment that names nobody was written down by a person, which is
                          what cash is. One that names a processor came from it. */}
                      {payment.provider ? ` · ${payment.provider}` : ' · recorded by hand'}
                      {payment.note ? ` · ${payment.note}` : null}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(payment.amountMinor, payment.currency)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <p className="mt-2 flex justify-between text-sm font-medium">
              {/* Paid-ness is this subtraction and nothing else. No status column exists to
                  say otherwise, which is why it can never say otherwise. */}
              <span>{standing.settled ? 'Settled' : 'Outstanding'}</span>
              <span className="tabular-nums">
                {standing.outstandingMinor === null
                  ? '—'
                  : formatMoney(standing.outstandingMinor, invoice.currency)}
              </span>
            </p>

            {mayBePaid && cardsAccepted && !standing.settled ? (
              <RequestCardPaymentForm
                organizationId={organizationId}
                workItemId={workItemId}
              />
            ) : null}

            {mayBePaid ? (
              <RecordPaymentForm
                organizationId={organizationId}
                workItemId={workItemId}
                invoiceId={invoice.id}
                currency={invoice.currency}
              />
            ) : (
              <p className="mt-3 text-sm opacity-60">
                Your role cannot record payments here.
              </p>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-sm opacity-60">
              {price
                ? 'Not invoiced yet.'
                : 'There is nothing priced on this job, so there is nothing to invoice.'}
            </p>
            {mayInvoice && price ? (
              <IssueInvoiceForm organizationId={organizationId} workItemId={workItemId} />
            ) : null}
            {!mayInvoice ? (
              <p className="mt-3 text-sm opacity-60">Your role cannot issue invoices here.</p>
            ) : null}
          </>
        )}
      </section>

      <section className="mt-8 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Margin</h2>
        {/* The number the owner asks for first, and the smallest useful version of it: what
            this job earned, less what it consumed. Not a report and not a dashboard — those
            are M6, where an aggregate layer is the whole milestone. */}

        {economics.marginMinor !== null && economics.currency ? (
          <p className="mt-2 flex justify-between text-sm">
            <span className="font-medium">
              {economics.marginMinor < 0 ? 'Loss on this job' : 'Margin on this job'}
            </span>
            <span className="font-medium tabular-nums">
              {formatMoney(economics.marginMinor, economics.currency)}
            </span>
          </p>
        ) : (
          <p className="mt-1 text-sm opacity-60">
            {/* Three different absences, said differently. A zero here would claim the job
                broke even, which is a much stronger statement than "we cannot say". */}
            {economics.revenue === null
              ? 'Nothing is priced on this job yet, so there is nothing to compare its costs against.'
              : 'This job is priced in one currency and its costs are recorded in another, so there is no single margin. The two totals are above.'}
          </p>
        )}
      </section>
    </>
  );
}
