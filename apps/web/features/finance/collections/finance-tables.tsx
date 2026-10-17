import Link from 'next/link';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { FinanceInvoiceRow } from '@/lib/application/finance/invoices';
import type { FinanceQuoteRow } from '@/lib/application/finance/quotes';
import type { PaymentRecord } from '@/lib/domain/billing/invoices';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { FinanceWorkflow } from '../finance-workflow';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@gold/ui/components/table';

const LINK = 'font-medium underline-offset-4 hover:underline';
const date = (iso: string, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));

/** Where a record opens: the work record owns the job, and the customer's own page owns the customer. Finance owns neither. */
const workHref = (organizationId: string, workItemId: string) => `/organizations/${organizationId}/work/${workItemId}?tab=financials`;
const customerHref = (organizationId: string, customerId: string) => `/organizations/${organizationId}/customers/${customerId}`;

export function InvoiceStandingBadge({ row }: { row: Pick<FinanceInvoiceRow, 'settled' | 'overdue'> }) {
  if (row.settled) return <Badge tone="success">Settled</Badge>;
  if (row.overdue) return <Badge tone="danger">Overdue</Badge>;
  return <Badge>Outstanding</Badge>;
}

export function InvoicesTable({ organizationId, rows, empty, mayRecord = false, compact = false, timezone = 'UTC' }: { organizationId: string; rows: FinanceInvoiceRow[]; empty: string; mayRecord?: boolean; compact?: boolean; timezone?: string }) {
  const inZone = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, month: 'short', day: 'numeric' }).format(new Date(iso));
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      actions={mayRecord ? row => <FinanceWorkflow organizationId={organizationId} kind="payment" workItemId={row.workItemId} compact /> : undefined}
      columns={[
        { key: 'number', header: 'Invoice', emphasis: 'primary', cell: (row) => <Link className={LINK} href={workHref(organizationId, row.workItemId)}>#{row.number}</Link> },
        { key: 'customer', header: 'Billed to', cell: (row) => row.customerId ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customerId)}>{row.billedTo}</Link> : row.billedTo },
        ...(!compact ? [{ key: 'issued', header: 'Issued', cell: (row: FinanceInvoiceRow) => inZone(row.issuedAt) }] : []),
        { key: 'due', header: 'Due', cell: (row) => row.dueAt ? inZone(row.dueAt) : 'No due date' },
        { key: 'standing', header: 'Standing', cell: (row) => <InvoiceStandingBadge row={row} /> },
        ...(!compact ? [{ key: 'total', header: 'Total', numeric: true, cell: (row: FinanceInvoiceRow) => row.total ? formatMoney(row.total.totalMinor, row.total.currency) : '—' },
        { key: 'paid', header: 'Paid', numeric: true, cell: (row: FinanceInvoiceRow) => formatMoney(row.paidMinor, row.currency) }] : []),
        { key: 'outstanding', header: 'Outstanding', numeric: true, cell: (row) => row.outstandingMinor === null ? '—' : formatMoney(Math.max(row.outstandingMinor, 0), row.currency) },
      ]}
    />
  );
}

export function PaymentsTable({ organizationId, rows, empty, compact = false, timezone = 'UTC' }: { organizationId: string; rows: PaymentRecord[]; empty: string; compact?: boolean; timezone?: string }) {
  if (compact) return rows.length ? <Table><TableHeader><TableRow>{['Received','Customer / Invoice','Amount'].map(h=><TableHead key={h} className="px-1 py-1.5 text-xs">{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map(r=><TableRow key={r.id}><TableCell className="px-1 py-2 text-xs text-muted">{date(r.receivedAt,timezone)}</TableCell><TableCell className="px-1 py-2 text-xs"><Link className={LINK} href={workHref(organizationId,r.workItemId)}>{r.billedTo}<span className="block text-muted">#{r.invoiceNumber}</span></Link></TableCell><TableCell className="px-1 py-2 text-right text-xs tabular-nums">{formatMoney(r.amountMinor,r.currency)}</TableCell></TableRow>)}</TableBody></Table> : <p className="py-5 text-sm text-muted">{empty}</p>;
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      columns={[
        { key: 'received', header: 'Received', emphasis: 'primary', cell: (row) => date(row.receivedAt,timezone) },
        { key: 'customer', header: 'Customer', cell: (row) => row.customerId ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customerId)}>{row.billedTo}</Link> : row.billedTo },
        { key: 'invoice', header: 'Invoice', cell: (row) => <Link className={LINK} href={workHref(organizationId, row.workItemId)}>#{row.invoiceNumber}</Link> },
        // Only what `payments` stores: no provider means a person wrote it down; nothing else is guessed.
        ...(!compact ? [{ key: 'source', header: 'Source', cell: (row: PaymentRecord) => row.provider ?? 'Recorded manually' },
        { key: 'reference', header: 'Reference', cell: (row: PaymentRecord) => row.providerReference ?? '—' },
        { key: 'note', header: 'Note', cell: (row: PaymentRecord) => row.note ?? '—' }] : []),
        { key: 'amount', header: 'Amount', numeric: true, cell: (row) => formatMoney(row.amountMinor, row.currency) },
      ]}
    />
  );
}

export function QuotesTable({ organizationId, rows, empty, mayIssue = false }: { organizationId: string; rows: FinanceQuoteRow[]; empty: string; mayIssue?: boolean }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.workItemId}
      empty={empty}
      actions={mayIssue ? row => row.invoiced ? <span className="text-xs text-muted">Already invoiced</span> : <FinanceWorkflow organizationId={organizationId} kind="invoice" workItemId={row.workItemId} compact /> : undefined}
      columns={[
        { key: 'work', header: 'Work', emphasis: 'primary', cell: (row) => <Link className={LINK} href={workHref(organizationId, row.workItemId)}>{row.title}</Link> },
        { key: 'customer', header: 'Customer', cell: (row) => row.customer ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customer.id)}>{row.customer.name}</Link> : '—' },
        // The tenant's own status word, rendered as written (`docs/ui-system.md`).
        { key: 'status', header: 'Status', cell: (row) => <Badge>{row.status}</Badge> },
        { key: 'invoiced', header: 'Invoice', cell: (row) => row.invoiced ? 'Invoiced' : 'Not invoiced' },
        { key: 'lines', header: 'Lines', numeric: true, cell: (row) => row.lineCount },
        { key: 'quoted', header: 'Quoted', numeric: true, cell: (row) => row.quoted ? formatMoney(row.quoted.totalMinor, row.quoted.currency) : '—' },
      ]}
    />
  );
}
