import Link from 'next/link';
import type { Opportunity } from '@/lib/domain/opportunities/opportunities';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
import { EmptyState } from '@/components/surfaces/section';

export function OpportunityTable({ organizationId, opportunities }: { organizationId: string; opportunities: Opportunity[] }) {
  if (!opportunities.length) return <EmptyState>No opportunities match this view.</EmptyState>;
  return <div className="overflow-x-auto rounded-lg border border-border">
    <table className="w-full text-left text-sm"><caption className="sr-only">Opportunities</caption>
      <thead className="bg-surface text-muted"><tr>{['Opportunity', 'Customer', 'Stage', 'Value', 'Owner', 'Expected close'].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-border">{opportunities.map((item) => <tr key={item.id}>
        <td className="px-4 py-3"><Link href={`/organizations/${organizationId}/opportunities/${item.id}`} className="font-medium underline underline-offset-4">{item.title}</Link></td>
        <td className="px-4 py-3"><Link href={`/organizations/${organizationId}/customers/${item.customerId}`} className="underline underline-offset-4">{item.customerName}</Link></td>
        <td className="px-4 py-3">{item.stage ? `${item.stage.name} (${item.stage.kind})` : 'Unstaged'}</td>
        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{item.amountMinor !== null && item.currency ? formatOpportunityValue(item.amountMinor, item.currency) : 'Not set'}</td>
        <td className="px-4 py-3">{item.ownerName ?? 'Unassigned'}</td><td className="whitespace-nowrap px-4 py-3">{item.expectedCloseOn ?? 'Not set'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
