import Link from 'next/link';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { PipelineSummary } from '@/features/crm/sales/pipeline-summary';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { Call, CallCounts } from '@/lib/domain/reception/calls';
import { callsHref } from './call-filters';

/**
 * What the Calls workspace opens with: the day in four numbers, each one a way into the history
 * below it filtered to exactly what it counted. Counted by the database, not from a page of rows.
 */
export function VoiceCounters({ organizationId, counts, todaysCalls }: {
  organizationId: string;
  counts: CallCounts;
  /** The most recent of today's calls, bounded — only the average is read from it. */
  todaysCalls: Call[];
}) {
  const base = `/organizations/${organizationId}/calls`;
  const durations = todaysCalls.flatMap((call) => call.durationSeconds === null || call.durationSeconds === 0 ? [] : [call.durationSeconds]);
  const average = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null;

  const tiles: { label: string; value: string | number; note: string; href?: string }[] = [
    { label: 'Calls today', value: counts.today, note: counts.active ? `${counts.active} live now` : 'None live now', href: callsHref(base, { when: 'today' }) },
    { label: 'Missed today', value: counts.missedToday, note: 'Inbound, not taken', href: callsHref(base, { state: 'missed', when: 'today' }) },
    { label: 'Needs wrap-up', value: counts.needsWrapUp, note: 'Answered, no outcome', href: counts.needsWrapUp ? callsHref(base, { wrap: '1' }) : undefined },
    { label: 'Average length', value: average === null ? '—' : `${average}s`, note: average === null ? 'No timed calls today' : `${durations.length} timed ${durations.length === 1 ? 'call' : 'calls'} today` },
  ];

  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => {
        const content = (
          <>
            <dt className="text-sm text-muted">{tile.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{tile.value}</dd>
            <p className="mt-0.5 text-xs text-subtle">{tile.note}</p>
          </>
        );
        return tile.href ? (
          <Link key={tile.label} href={tile.href} scroll={false} className="rounded border border-border p-3 hover:bg-hover">{content}</Link>
        ) : (
          <div key={tile.label} className="rounded border border-border p-3">{content}</div>
        );
      })}
    </dl>
  );
}

/** What was written up today, and the CRM pipeline the calls feed — beneath the history, because the history is what the screen is for. */
export function VoiceDayDetail({ organizationId, todaysCalls, customers, stages }: {
  organizationId: string;
  todaysCalls: Call[];
  customers: Customer[];
  stages: CustomerStage[];
}) {
  const perOutcome = new Map<string, number>();
  for (const call of todaysCalls) if (call.outcome) perOutcome.set(call.outcome.name, (perOutcome.get(call.outcome.name) ?? 0) + 1);

  return (
    <WidgetGrid className="mt-10">
      <Widget title="Call outcomes today" wide>
        {perOutcome.size === 0 ? <EmptyState weight="subtle">Nothing has been written up today.</EmptyState> : (
          <DividedList className="text-sm">{[...perOutcome.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => <li key={name} className="flex gap-2 py-1.5"><span>{name}</span><span className="ml-auto tabular-nums text-muted">{count}</span></li>)}</DividedList>
        )}
      </Widget>
      <Widget title="CRM pipeline" wide href={stages.length ? `/organizations/${organizationId}/customers/pipeline` : undefined}>
        <PipelineSummary stages={stages} customers={customers} />
      </Widget>
    </WidgetGrid>
  );
}
