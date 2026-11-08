import Link from 'next/link';
import { AlertTriangle, CheckCircle2, CircleDot, PanelRight, Undo2 } from 'lucide-react';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { FinanceInvoiceRow } from '@/lib/application/finance/invoices';
import type { FinanceQuoteRow } from '@/lib/application/finance/quotes';
import type { PaymentRecord } from '@/lib/domain/billing/invoices';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { InvoiceDialog } from '../transactions/invoice-dialog';
import { PaymentDialog } from '../transactions/payment-dialog';

const LINK = 'font-medium underline-offset-4 hover:underline';
const date = (iso: string, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

/** Where a record opens: the work record owns the job, and the customer's own page owns the customer. Finance owns neither. */
export const workHref = (organizationId: string, workItemId: string) => `/organizations/${organizationId}/work/${workItemId}?tab=financials`;
/** The customer's commercial proposals in CRM, where an invoiced proposal's version history is read. */
export const proposalHref = (organizationId: string, customerId: string) => `/organizations/${organizationId}/crm/contacts/${customerId}?section=sales&view=commercial`;
/**
 * Where an invoice opens. A Work invoice belongs to its Work item's Financials; a direct or proposal
 * invoice has no Work record, so it opens in Finance's own invoice inspector. Never a Work link for an invoice without Work.
 */
export const invoiceHref = (organizationId: string, invoice: { id: string; workItemId: string | null }) =>
  invoice.workItemId ? workHref(organizationId, invoice.workItemId) : `/organizations/${organizationId}/finance/invoices?invoice=${invoice.id}`;
const customerHref = (organizationId: string, customerId: string) => `/organizations/${organizationId}/crm/contacts/${customerId}`;

/** Settled, overdue or outstanding — told by word and icon as well as colour. */
export function InvoiceStandingBadge({ row }: { row: Pick<FinanceInvoiceRow, 'settled' | 'overdue'> }) {
  if (row.settled) return <Badge tone="success" className="gap-1"><CheckCircle2 aria-hidden className="size-3" />Settled</Badge>;
  if (row.overdue) return <Badge tone="danger" className="gap-1"><AlertTriangle aria-hidden className="size-3" />Overdue</Badge>;
  return <Badge className="gap-1"><CircleDot aria-hidden className="size-3" />Outstanding</Badge>;
}

/** A correction is a negative row; it is labelled as one, never shown as an ordinary receipt. */
export function PaymentEntryBadge({ amountMinor }: { amountMinor: number }) {
  return amountMinor < 0 ? <Badge tone="danger" className="gap-1"><Undo2 aria-hidden className="size-3" />Correction</Badge> : <Badge>Receipt</Badge>;
}

export function InvoicesTable({ organizationId, rows, empty, mayRecord = false, compact = false, timezone = 'UTC', today = '', inspectHref }: { organizationId: string; rows: FinanceInvoiceRow[]; empty: string; mayRecord?: boolean; compact?: boolean; timezone?: string; today?: string; inspectHref?: (invoiceId: string) => string }) {
  const inZone = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(iso));
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      tableFrom={compact ? 'default' : 'wide'}
      actions={mayRecord || inspectHref ? row => <>
        {inspectHref ? <Link href={inspectHref(row.id)} scroll={false} data-inspect-invoice={row.id} aria-label={`Preview invoice #${row.number}`} className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium hover:bg-hover"><PanelRight aria-hidden className="size-3.5" />Preview</Link> : null}
        {mayRecord && today ? row.settled
          ? <PaymentDialog organizationId={organizationId} invoiceId={row.id} today={today} entry="correction" label="Correction" ariaLabel={`Record a correction on invoice #${row.number}`} size="tiny" tone="ghost" />
          : <PaymentDialog organizationId={organizationId} invoiceId={row.id} today={today} label="Record payment" ariaLabel={`Record payment for invoice #${row.number}`} size="tiny" /> : null}
      </> : undefined}
      columns={[
        { key: 'number', header: 'Invoice', emphasis: 'primary', cell: (row) => <span className="flex flex-col"><Link className={LINK} href={invoiceHref(organizationId, row)}>#{row.number}</Link>{row.source === 'work_item' ? null : <span className="text-xs text-muted">{row.source === 'direct' ? 'Direct' : 'Proposal'}</span>}</span> },
        { key: 'customer', header: 'Customer', cell: (row) => row.customerId ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customerId)}>{row.billedTo}</Link> : row.billedTo },
        ...(!compact ? [{ key: 'issued', header: 'Issued', cell: (row: FinanceInvoiceRow) => inZone(row.issuedAt), cardValue: () => null }] : []),
        { key: 'due', header: 'Due', cell: (row) => row.dueAt ? inZone(row.dueAt) : 'No due date' },
        { key: 'standing', header: 'Status', cell: (row) => <InvoiceStandingBadge row={row} /> },
        // Narrow cards keep identity, due date, status and what is owed; issue date, total and paid stay in the table and on the invoice.
        ...(!compact ? [{ key: 'total', header: 'Total', numeric: true, cell: (row: FinanceInvoiceRow) => row.total ? formatMoney(row.total.totalMinor, row.total.currency) : '—', cardValue: () => null },
        { key: 'paid', header: 'Paid', numeric: true, cell: (row: FinanceInvoiceRow) => formatMoney(row.paidMinor, row.currency), cardValue: () => null }] : []),
        { key: 'outstanding', header: 'Outstanding', numeric: true, cell: (row) => row.outstandingMinor === null ? '—' : <span className={row.overdue ? 'font-semibold text-danger' : row.settled ? 'text-muted' : 'font-semibold'}>{formatMoney(Math.max(row.outstandingMinor, 0), row.currency)}</span> },
      ]}
    />
  );
}

export function PaymentsTable({ organizationId, rows, empty, timezone = 'UTC' }: { organizationId: string; rows: PaymentRecord[]; empty: string; timezone?: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      tableFrom="wide"
      columns={[
        { key: 'received', header: 'Received', emphasis: 'primary', cell: (row) => date(row.receivedAt, timezone) },
        { key: 'invoice', header: 'Invoice', cell: (row) => <Link className={LINK} href={invoiceHref(organizationId, { id: row.invoiceId, workItemId: row.workItemId })}>#{row.invoiceNumber}</Link> },
        { key: 'customer', header: 'Customer', cell: (row) => row.customerId ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customerId)}>{row.billedTo}</Link> : row.billedTo },
        { key: 'entry', header: 'Entry', cell: (row) => <PaymentEntryBadge amountMinor={row.amountMinor} /> },
        // Only what `payments` stores: no provider means a person wrote it down; nothing else is guessed.
        { key: 'source', header: 'Source', cell: (row: PaymentRecord) => row.provider ? `Through ${row.provider === 'stripe' ? 'Stripe' : 'card payment'}` : 'Recorded by hand' },
        { key: 'reference', header: 'Reference', cell: (row: PaymentRecord) => row.providerReference ?? row.note ?? '—', cardValue: (row: PaymentRecord) => row.providerReference ?? row.note ?? null },
        { key: 'amount', header: 'Amount', numeric: true, cell: (row) => <span className={row.amountMinor < 0 ? 'text-danger' : 'font-semibold'}>{formatMoney(row.amountMinor, row.currency)}</span> },
      ]}
    />
  );
}

export function QuotesTable({ organizationId, rows, empty, mayIssue = false, today = '' }: { organizationId: string; rows: FinanceQuoteRow[]; empty: string; mayIssue?: boolean; today?: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.workItemId}
      empty={empty}
      actions={row => row.invoiced
        ? <Link className="text-xs font-medium text-accent-text underline-offset-4 hover:underline" href={workHref(organizationId, row.workItemId)}>View invoice</Link>
        : mayIssue && today && row.quoted ? <InvoiceDialog organizationId={organizationId} workItemId={row.workItemId} today={today} label="Invoice" ariaLabel={`Invoice ${row.title}`} size="tiny" /> : null}
      columns={[
        { key: 'work', header: 'Work', emphasis: 'primary', cell: (row) => <Link className={LINK} href={workHref(organizationId, row.workItemId)}>{row.title}</Link> },
        { key: 'customer', header: 'Contact', cell: (row) => row.customer ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customer.id)}>{row.customer.name}</Link> : 'No contact' },
        { key: 'quoted', header: 'Quoted', numeric: true, cell: (row) => row.quoted ? <span className="font-semibold">{formatMoney(row.quoted.totalMinor, row.quoted.currency)}</span> : '—' },
        { key: 'currency', header: 'Currency', cell: (row) => row.quoted?.currency ?? '—', cardValue: () => null },
        { key: 'lines', header: 'Lines', numeric: true, cell: (row) => row.lineCount, cardValue: () => null },
        { key: 'invoiced', header: 'Invoice', cell: (row) => row.invoiced ? <Badge className="gap-1"><CheckCircle2 aria-hidden className="size-3" />Invoiced</Badge> : <Badge>Not invoiced</Badge> },
        // The tenant's own status word, rendered as written (`docs/ui-system.md`).
        { key: 'status', header: 'Stage', cell: (row) => row.status },
      ]}
    />
  );
}
