import Link from 'next/link';
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
    { label: 'Recent call average', value: average === null ? '—' : `${average}s`, note: average === null ? 'No timed calls today' : `${durations.length} sampled timed ${durations.length === 1 ? 'call' : 'calls'} today` },
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
