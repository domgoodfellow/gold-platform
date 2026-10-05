import Link from 'next/link';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { FinanceInvoiceRow } from '@/lib/application/finance/invoices';
import type { FinanceQuoteRow } from '@/lib/application/finance/quotes';
import type { PaymentRecord } from '@/lib/domain/billing/invoices';
import { formatMoney } from '@/lib/domain/work-items/consumption';

const LINK = 'font-medium underline-offset-4 hover:underline';
const date = (iso: string) => new Date(iso).toLocaleDateString();

/** Where a record opens: the work record owns the job, and the customer's own page owns the customer. Finance owns neither. */
const workHref = (organizationId: string, workItemId: string) => `/organizations/${organizationId}/work/${workItemId}`;
const customerHref = (organizationId: string, customerId: string) => `/organizations/${organizationId}/customers/${customerId}`;

export function InvoiceStandingBadge({ row }: { row: Pick<FinanceInvoiceRow, 'settled' | 'overdue'> }) {
  if (row.settled) return <Badge tone="success">Settled</Badge>;
  if (row.overdue) return <Badge tone="danger">Overdue</Badge>;
  return <Badge>Outstanding</Badge>;
}

export function InvoicesTable({ organizationId, rows, empty }: { organizationId: string; rows: FinanceInvoiceRow[]; empty: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      columns={[
        { key: 'number', header: 'Invoice', emphasis: 'primary', cell: (row) => <Link className={LINK} href={workHref(organizationId, row.workItemId)}>#{row.number}</Link> },
        { key: 'customer', header: 'Billed to', cell: (row) => row.customerId ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customerId)}>{row.billedTo}</Link> : row.billedTo },
        { key: 'issued', header: 'Issued', cell: (row) => date(row.issuedAt) },
        { key: 'due', header: 'Due', cell: (row) => row.dueAt ? date(row.dueAt) : '—' },
        { key: 'standing', header: 'Standing', cell: (row) => <InvoiceStandingBadge row={row} /> },
        { key: 'total', header: 'Total', numeric: true, cell: (row) => row.total ? formatMoney(row.total.totalMinor, row.total.currency) : '—' },
        { key: 'outstanding', header: 'Outstanding', numeric: true, cell: (row) => row.outstandingMinor === null ? '—' : formatMoney(Math.max(row.outstandingMinor, 0), row.currency) },
      ]}
    />
  );
}

export function PaymentsTable({ organizationId, rows, empty }: { organizationId: string; rows: PaymentRecord[]; empty: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.id}
      empty={empty}
      columns={[
        { key: 'received', header: 'Received', emphasis: 'primary', cell: (row) => new Date(row.receivedAt).toLocaleString() },
        { key: 'customer', header: 'Customer', cell: (row) => row.customerId ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customerId)}>{row.billedTo}</Link> : row.billedTo },
        { key: 'invoice', header: 'Invoice', cell: (row) => <Link className={LINK} href={workHref(organizationId, row.workItemId)}>#{row.invoiceNumber}</Link> },
        // Only what `payments` stores: no provider means a person wrote it down; nothing else is guessed.
        { key: 'source', header: 'Source', cell: (row) => row.provider ?? 'Recorded by hand' },
        { key: 'reference', header: 'Reference', cell: (row) => row.providerReference ?? '—' },
        { key: 'amount', header: 'Amount', numeric: true, cell: (row) => formatMoney(row.amountMinor, row.currency) },
      ]}
    />
  );
}

export function QuotesTable({ organizationId, rows, empty }: { organizationId: string; rows: FinanceQuoteRow[]; empty: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(row) => row.workItemId}
      empty={empty}
      columns={[
        { key: 'work', header: 'Work', emphasis: 'primary', cell: (row) => <Link className={LINK} href={workHref(organizationId, row.workItemId)}>{row.title}</Link> },
        { key: 'customer', header: 'Customer', cell: (row) => row.customer ? <Link className="underline-offset-4 hover:underline" href={customerHref(organizationId, row.customer.id)}>{row.customer.name}</Link> : '—' },
        // The tenant's own status word, rendered as written (ui-spec §7).
        { key: 'status', header: 'Status', cell: (row) => <Badge>{row.status}</Badge> },
        { key: 'invoiced', header: 'Invoice', cell: (row) => row.invoiced ? 'Invoiced' : 'Not invoiced' },
        { key: 'lines', header: 'Lines', numeric: true, cell: (row) => row.lineCount },
        { key: 'quoted', header: 'Quoted', numeric: true, cell: (row) => row.quoted ? formatMoney(row.quoted.totalMinor, row.quoted.currency) : '—' },
      ]}
    />
  );
}
