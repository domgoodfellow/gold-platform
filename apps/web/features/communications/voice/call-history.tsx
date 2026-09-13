import type { ReactNode } from 'react';
import { DividedList, EmptyState } from '@/components/containers/section';
import type { Call } from '@/lib/domain/reception/calls';

/**
 * One call, read the same way wherever it appears: what the network did, what the tenant said,
 * and the note somebody left.
 *
 * **The one place this row is built.** The floor's day (every call) and one customer's own
 * history used to render this independently in two route files, which is exactly the "a second
 * answer" pattern `constraints.md` warns drifts apart first in the row nobody is looking at.
 */
function CallRow({
  call,
  customerName,
  wrapUp,
}: {
  call: Call;
  customerName?: string;
  wrapUp?: ReactNode;
}) {
  const direction = call.direction === 'inbound' ? 'Inbound' : 'Outbound';

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        {/* On a single customer's own page there is no name to lead with, so the direction
            takes the primary position it would otherwise have as ordinary muted text. */}
        <span className="font-medium">{customerName ?? direction}</span>
        <span className="text-sm text-muted">
          {[
            customerName ? direction : null,
            call.toNumber,
            // The network's own account, rendered as written. A business's word for how it
            // went is the outcome below, and the two are never merged.
            call.status.replace('_', ' '),
            call.durationSeconds === null ? null : `${call.durationSeconds}s`,
            call.outcome?.name ?? null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      {call.note ? <p className="mt-1 text-sm">{call.note}</p> : null}

      {wrapUp}
    </li>
  );
}

/**
 * A list of calls.
 *
 * `customerNames` is given on a floor-wide list (many customers, one screen) and omitted on a
 * single customer's own page, where the name is already the page's own heading. `renderWrapUp`
 * is given only where wrap-up is part of the surface — the Calls page — and omitted on the
 * customer detail page, which does not offer it today.
 */
export function CallHistory({
  calls,
  customerNames,
  renderWrapUp,
  empty = 'No calls recorded.',
}: {
  calls: Call[];
  customerNames?: Map<string, string>;
  renderWrapUp?: (call: Call) => ReactNode;
  empty?: string;
}) {
  if (calls.length === 0) {
    return <EmptyState className="mt-2">{empty}</EmptyState>;
  }

  return (
    <DividedList>
      {calls.map((call) => (
        <CallRow
          key={call.id}
          call={call}
          customerName={customerNames?.get(call.customerId) ?? undefined}
          wrapUp={renderWrapUp ? renderWrapUp(call) : null}
        />
      ))}
    </DividedList>
  );
}
