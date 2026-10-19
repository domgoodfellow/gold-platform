import { MetricTile } from '@/components/operational/primitives';
import type { Call, CallCounts } from '@/lib/domain/reception/calls';
import { callsHref } from './call-filters';

/**
 * The day in four numbers, supporting the Dialer rather than competing with it: each figure is a
 * way into the call history filtered to exactly what it counted. Counted by the database, not
 * from a page of rows.
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
  const history = (params: Parameters<typeof callsHref>[1]) => `${callsHref(base, params)}#call-history`;

  return (
    <section aria-label="Today" className="@container">
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <MetricTile label="Calls today" value={counts.today} detail={counts.active ? `${counts.active} live now` : 'None live now'} href={history({ when: 'today' })} />
        <MetricTile label="Missed today" value={counts.missedToday} detail="Inbound, not taken" href={history({ state: 'missed', when: 'today' })} />
        <MetricTile label="Needs wrap-up" value={counts.needsWrapUp} detail="Answered, no outcome" href={counts.needsWrapUp ? history({ wrap: '1' }) : undefined} />
        <MetricTile label="Average length" value={average === null ? '—' : `${average}s`} detail={average === null ? 'No timed calls today' : `${durations.length} timed ${durations.length === 1 ? 'call' : 'calls'} today`} />
      </div>
    </section>
  );
}
