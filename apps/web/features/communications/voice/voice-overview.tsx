import Link from 'next/link';
import { DividedList, EmptyState, SectionHeading } from '@/components/containers/section';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { PipelineSummary } from '@/features/crm/sales/pipeline-summary';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { Call } from '@/lib/domain/reception/calls';
import { CallHistory } from './call-history';

export function VoiceOverview({ organizationId, calls, todaysCalls, customers, stages }: {
  organizationId: string;
  calls: Call[];
  todaysCalls: Call[];
  customers: Customer[];
  stages: CustomerStage[];
}) {
  const names = new Map(customers.map((customer) => [customer.id, customer.name]));
  const reached = todaysCalls.filter((call) => call.outcome?.reached).length;
  const needsWrapUp = calls.filter((call) => call.outcome === null).length;
  const durations = todaysCalls.flatMap((call) => call.durationSeconds === null ? [] : [call.durationSeconds]);
  const average = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;
  const perOutcome = new Map<string, number>();
  for (const call of calls) if (call.outcome) perOutcome.set(call.outcome.name, (perOutcome.get(call.outcome.name) ?? 0) + 1);

  return (
    <>
      <WidgetGrid className="mt-6">
        <Widget title="Calls today" value={todaysCalls.length} note={`${calls.length} recorded in all`} href={calls.length ? `/organizations/${organizationId}/calls?widget=calls` : undefined}>
          {todaysCalls.length === 0 ? <EmptyState weight="subtle">No calls today.</EmptyState> : (
            <DividedList className="text-sm">{todaysCalls.slice(0, 4).map((call) => <li key={call.id} className="flex gap-2 py-1.5"><Link href={`/organizations/${organizationId}/customers/${call.customerId}`} className="min-w-0 truncate underline underline-offset-4">{names.get(call.customerId) ?? 'A customer'}</Link><span className="ml-auto shrink-0 text-muted">{call.outcome?.name ?? call.status.replaceAll('_', ' ')}</span></li>)}</DividedList>
          )}
        </Widget>
        <Widget title="Reached today" value={reached} note="Calls marked as a conversation" />
        <Widget title="Needs wrap-up" value={needsWrapUp} note="Calls without an outcome" href={needsWrapUp ? `/organizations/${organizationId}/calls?widget=calls` : undefined} />
        <Widget title="Average duration" value={average === null ? '—' : `${average}s`} note={average === null ? 'No durations recorded today' : 'Across today’s timed calls'} />
        <Widget title="Call outcomes" wide>
          {perOutcome.size === 0 ? <EmptyState weight="subtle">Nothing has been written up yet.</EmptyState> : (
            <DividedList className="text-sm">{[...perOutcome.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => <li key={name} className="flex gap-2 py-1.5"><span>{name}</span><span className="ml-auto tabular-nums text-muted">{count}</span></li>)}</DividedList>
          )}
        </Widget>
        <Widget title="CRM pipeline" wide href={stages.length ? `/organizations/${organizationId}/customers/pipeline` : undefined}>
          <PipelineSummary stages={stages} customers={customers} />
        </Widget>
      </WidgetGrid>
      <section className="mt-10">
        <SectionHeading>Recent calls</SectionHeading>
        <div className="mt-3"><CallHistory calls={calls.slice(0, 5)} customerNames={names} /></div>
      </section>
    </>
  );
}
