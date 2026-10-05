import Link from 'next/link';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import { InvoiceStandingBadge } from '@/features/finance/collections/finance-tables';
import type { FinanceAttention, FinanceOverview } from '@/lib/application/finance/finance-overview';
import { formatMoney } from '@/lib/domain/work-items/consumption';

function attentionText(item: FinanceAttention): string {
  switch (item.kind) {
    case 'overdue_invoices': return `${item.count} ${item.count === 1 ? 'invoice is' : 'invoices are'} past ${item.count === 1 ? 'its' : 'their'} due date and unpaid.`;
    case 'unpaid_invoices': return `${item.count} ${item.count === 1 ? 'invoice is' : 'invoices are'} unpaid.`;
    case 'quoted_not_invoiced': return `${item.jobs} quoted ${item.jobs === 1 ? 'job has' : 'jobs have'} no invoice yet.`;
    case 'setup': return item.message;
  }
}

function attentionHref(base: string, pricing: string, item: FinanceAttention): string {
  switch (item.kind) {
    case 'overdue_invoices':
    case 'unpaid_invoices': return `${base}/invoices`;
    case 'quoted_not_invoiced': return `${base}/quotes`;
    case 'setup': return pricing;
  }
}

/**
 * Finance Home draws a `FinanceOverview` and decides nothing: every figure and every attention
 * item arrived computed by the application layer from the domain's own reads. Money is shown one
 * currency at a time, and an unknown cost reads as unknown, never as zero.
 */
export function FinanceHomeBody({
  organizationId,
  overview,
}: {
  organizationId: string;
  overview: FinanceOverview;
}) {
  const base = `/organizations/${organizationId}/finance`;
  const pricing = `/organizations/${organizationId}/settings/pricing`;

  return (
    <>
      {overview.empty && overview.attention.length === 0 ? (
        <EmptyState
          title="No financial activity yet"
          description="Price a work item and it appears under Quotes. Issue an invoice from it and record a payment, and they appear here."
        />
      ) : (
        <>
          {overview.attention.length > 0 ? (
            <Section className="mb-6">
              <SectionHeading>Needs attention</SectionHeading>
              <DividedList className="mt-2 text-sm">
                {overview.attention.map((item) => (
                  <li key={item.kind === 'setup' ? `setup-${item.module}` : item.kind} className="py-2">
                    <Link className="underline-offset-4 hover:underline" href={attentionHref(base, pricing, item)}>{attentionText(item)}</Link>
                  </li>
                ))}
              </DividedList>
            </Section>
          ) : null}

          {overview.partial ? <p className="mb-3 text-xs text-muted">Showing the most recent records only — figures below cover those, not everything.</p> : null}

          <WidgetGrid>
            <Widget title="Outstanding" href={`${base}/invoices`}>
              {overview.outstanding.length === 0 ? (
                <EmptyState>Nothing is outstanding.</EmptyState>
              ) : (
                <DividedList as="div" className="text-sm">
                  {overview.outstanding.map((entry) => (
                    <div key={entry.currency} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                      <span className="text-muted">{entry.invoices} {entry.invoices === 1 ? 'invoice' : 'invoices'}</span>
                      <span className="font-medium tabular-nums">{formatMoney(entry.outstandingMinor, entry.currency)}</span>
                    </div>
                  ))}
                </DividedList>
              )}
            </Widget>

            <Widget title="Quoted, not invoiced" href={`${base}/quotes`}>
              {overview.awaitingInvoice.length === 0 ? (
                <EmptyState>No quoted work is waiting to be invoiced.</EmptyState>
              ) : (
                <DividedList as="div" className="text-sm">
                  {overview.awaitingInvoice.map((entry) => (
                    <div key={entry.currency} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                      <span className="text-muted">{entry.jobs} {entry.jobs === 1 ? 'job' : 'jobs'}</span>
                      <span className="font-medium tabular-nums">{formatMoney(entry.quotedMinor, entry.currency)}</span>
                    </div>
                  ))}
                </DividedList>
              )}
            </Widget>

            {overview.month ? (
              <Widget title="This month" wide>
                {overview.month.length === 0 ? (
                  <EmptyState>Nothing invoiced or incurred this month.</EmptyState>
                ) : (
                  <div className="divide-y divide-border text-sm">
                    {overview.month.map((total) => (
                      <dl key={total.currency} className="grid grid-cols-3 gap-x-4 py-2">
                        <div><dt className="text-muted">Invoiced</dt><dd className="font-medium tabular-nums">{formatMoney(total.invoicedMinor, total.currency)}</dd></div>
                        <div><dt className="text-muted">Costs recorded</dt><dd className="font-medium tabular-nums">{total.incurredMinor === null ? 'Unknown' : formatMoney(total.incurredMinor, total.currency)}</dd></div>
                        <div><dt className="text-muted">Margin on recorded costs</dt><dd className="font-medium tabular-nums">{total.marginMinor === null ? 'Unknown' : formatMoney(total.marginMinor, total.currency)}</dd></div>
                      </dl>
                    ))}
                  </div>
                )}
              </Widget>
            ) : null}

            <Widget title="Recent invoices" href={`${base}/invoices`}>
              {overview.recentInvoices.length === 0 ? (
                <EmptyState>No invoices yet.</EmptyState>
              ) : (
                <DividedList as="div" className="text-sm">
                  {overview.recentInvoices.map((invoice) => (
                    <div key={invoice.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                      <span className="min-w-0 truncate">#{invoice.number} · {invoice.billedTo}</span>
                      <span className="flex items-center gap-2">
                        <InvoiceStandingBadge row={invoice} />
                        <span className="tabular-nums text-muted">{invoice.total ? formatMoney(invoice.total.totalMinor, invoice.total.currency) : '—'}</span>
                      </span>
                    </div>
                  ))}
                </DividedList>
              )}
            </Widget>

            <Widget title="Recent payments" href={`${base}/payments`}>
              {overview.recentPayments.length === 0 ? (
                <EmptyState>No payments recorded yet.</EmptyState>
              ) : (
                <DividedList as="div" className="text-sm">
                  {overview.recentPayments.map((payment) => (
                    <div key={payment.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
                      <span className="min-w-0 truncate">#{payment.invoiceNumber} · {payment.billedTo}</span>
                      <span className="tabular-nums text-muted">{formatMoney(payment.amountMinor, payment.currency)}</span>
                    </div>
                  ))}
                </DividedList>
              )}
            </Widget>
          </WidgetGrid>
        </>
      )}
    </>
  );
}
