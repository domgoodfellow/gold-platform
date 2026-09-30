import Link from 'next/link';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { Badge } from '@/components/display/data';
import { invoiceStanding, type Invoice } from '@/lib/domain/billing/invoices';
import { formatMoney } from '@/lib/domain/work-items/consumption';

export function CustomerFinancialSummary({ organizationId, invoices, timezone }: { organizationId: string; invoices: Invoice[]; timezone: string }) {
  if (invoices.length === 0) return <EmptyState>Nothing invoiced yet.</EmptyState>;
  return (
    <DividedList>{invoices.map((invoice) => {
      const standing = invoiceStanding(invoice);
      return (
        <li key={invoice.id} className="flex flex-col gap-1 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href={`/organizations/${organizationId}/work/${invoice.workItemId}`} className="font-medium underline underline-offset-4">Invoice #{invoice.number}</Link>
            <Badge>{standing.settled ? 'Settled' : 'Outstanding'}</Badge>
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-muted">
            <span>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: timezone }).format(new Date(invoice.issuedAt))}</span>
            <span className="tabular-nums">{standing.total ? formatMoney(standing.total.totalMinor, standing.total.currency) : '—'}</span>
          </div>
        </li>
      );
    })}</DividedList>
  );
}
