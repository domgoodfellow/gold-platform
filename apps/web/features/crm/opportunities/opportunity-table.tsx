import { BusinessLabel } from '@/lib/context/business-vocabulary';
import Link from 'next/link';
import type { Opportunity } from '@/lib/domain/opportunities/opportunities';
import { formatOpportunityValue } from '@/lib/domain/opportunities/money';
import { EmptyState } from '@/components/surfaces/section';
import { FollowUpSheet,type FollowUpOptions } from '@/features/crm/follow-ups/follow-up-sheet';

export function OpportunityTable({ organizationId, opportunities, timezone = 'UTC',followUpOptions }: { organizationId: string; opportunities: Opportunity[]; timezone?: string;followUpOptions?:FollowUpOptions }) {
  if (!opportunities.length) return <EmptyState>No opportunities match this view.</EmptyState>;
  return <div className="overflow-x-auto rounded-lg border border-border">
    <table className="w-full text-left text-sm"><caption className="sr-only"><BusinessLabel>Opportunities</BusinessLabel></caption>
      <thead className="bg-surface text-muted"><tr>{['Opportunity', 'Customer', 'Stage', 'Value', 'Next follow-up', 'Owner', 'Expected close'].map((label) => <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead>
      <tbody className="divide-y divide-border">{opportunities.map((item) => <tr key={item.id}>
        <td className="px-4 py-3"><Link href={`/organizations/${organizationId}/crm/opportunities/${item.id}`} className="font-medium underline underline-offset-4">{item.title}</Link></td>
        <td className="px-4 py-3"><Link href={`/organizations/${organizationId}/crm/contacts/${item.customerId}`} className="underline underline-offset-4">{item.customerName}</Link></td>
        <td className="px-4 py-3">{item.stage ? `${item.stage.name} (${item.stage.kind})` : 'Unstaged'}</td>
        <td className="whitespace-nowrap px-4 py-3 tabular-nums">{item.amountMinor !== null && item.currency ? formatOpportunityValue(item.amountMinor, item.currency) : 'Not set'}</td>
        <td className="min-w-40 px-4 py-3">{item.nextFollowUp ? <>{followUpOptions?<FollowUpSheet {...followUpOptions} reference={item.nextFollowUp}/>:<p>{item.nextFollowUp.title}</p>}<p className="mt-1 text-xs text-muted">{new Intl.DateTimeFormat('en-CA',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(item.nextFollowUp.dueAt))}</p></> : <span className="text-muted">Not scheduled</span>}</td>
        <td className="px-4 py-3">{item.ownerName ?? 'Unassigned'}</td><td className="whitespace-nowrap px-4 py-3">{item.expectedCloseOn ?? 'Not set'}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}
