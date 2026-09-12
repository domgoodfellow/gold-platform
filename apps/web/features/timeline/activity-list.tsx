import { DividedList, EmptyState } from '@/components/containers/section';
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
}: {
  timeline: TimelineEntry[];
  timezone: string;
  emptyMessage?: string;
}) {
  if (timeline.length === 0) {
    return <EmptyState weight="subtle" className="mt-1">{emptyMessage}</EmptyState>;
  }

  return (
    <DividedList as="ol" className="mt-2">
      {timeline.map((entry) => (
        <li key={entry.id} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-3">
          {/* The instant, in this business's zone (I9). `formatWindow` takes a range and this
              is a moment, so the same rule is applied with the same zone rather than a second
              formatter deciding for itself. */}
          <time
            dateTime={entry.occurredAt}
            className="shrink-0 text-xs tabular-nums text-subtle sm:w-40 sm:pt-0.5"
          >
            {new Intl.DateTimeFormat('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
              timeZone: timezone,
            }).format(new Date(entry.occurredAt))}
          </time>
          <div className="min-w-0 text-sm">
            <div>{entry.description}</div>
            {/* I11 is an actor id; a name is what this tenant chose to call them, and somebody
                who has left the business no longer has one (D19). */}
            <div className="text-xs text-subtle">{entry.actorName ?? 'A former member'}</div>
          </div>
        </li>
      ))}
    </DividedList>
  );
}
