import Link from 'next/link';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { cx } from '@/components/class-names';
import type { TimelineEntry } from '@/lib/domain/timeline/timeline';

/**
 * A record's own history, rendered the same way wherever one exists.
 *
 * The interpretive work — which events count, what sentence each becomes — stays in
 * `lib/domain/timeline/timeline.ts`, scoped and authoritative per caller (`listCustomerTimeline`,
 * `listWorkItemTimeline`). This is only the second half: the same list markup, extracted once a
 * second caller for it existed rather than copied for it.
 */
export function ActivityList({
  timeline,
  timezone,
  emptyMessage = 'Nothing recorded yet.',
  compact = false, organizationId, dense = false,
}: {
  timeline: TimelineEntry[];
  timezone: string;
  emptyMessage?: string;
  /** Stacks the time above the sentence at every width — for a narrow rail, where a viewport breakpoint says nothing about the room the list has. */
  compact?: boolean; organizationId?: string; dense?: boolean;
}) {
  if (timeline.length === 0) {
    return <EmptyState weight="subtle" className="mt-1">{emptyMessage}</EmptyState>;
  }

  return (
    <DividedList as="ol" className="mt-2">
      {timeline.map((entry) => (
        <li key={entry.id} className={cx('flex gap-0.5 py-2', dense ? 'flex-row items-start gap-2' : 'flex-col', !compact && 'sm:flex-row sm:gap-3')}>
          {/* The instant, in this business's zone (I9). `formatWindow` takes a range and this
              is a moment, so the same rule is applied with the same zone rather than a second
              formatter deciding for itself. */}
          <time
            dateTime={entry.occurredAt}
            title={new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(entry.occurredAt))}
            className={cx('shrink-0 tabular-nums text-subtle', dense ? 'order-last text-[10px]' : 'text-xs', !compact && 'sm:w-40 sm:pt-0.5')}
          >
            {new Intl.DateTimeFormat('en-GB', {
              dateStyle: dense ? undefined : 'medium',
              timeStyle: 'short',
              timeZone: timezone,
            }).format(new Date(entry.occurredAt))}
          </time>
          <div className={cx('min-w-0', dense ? 'flex-1 text-xs' : 'text-sm')}>
            <div>{organizationId && entry.record && ['work_item', 'resource', 'location', 'customer', 'asset'].includes(entry.record.type) ? <Link className="hover:underline" href={`/organizations/${organizationId}/${({ work_item: 'work', resource: 'resources', location: 'locations', customer: 'customers', asset: 'assets' } as Record<string, string>)[entry.record.type]}/${entry.record.id}`}>{entry.description}</Link> : entry.description}</div>
            {/* I11 is an actor id; a name is what this tenant chose to call them, and somebody
                who has left the business no longer has one (D19). */}
            {!dense ? <div className="text-xs text-subtle">{entry.actorName ?? 'A former member'}</div> : null}
          </div>
        </li>
      ))}
    </DividedList>
  );
}
