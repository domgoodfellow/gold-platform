import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { PanelState } from '@/components/operational/primitives';
import type { Call } from '@/lib/domain/reception/calls';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import { callerName, formatCallDuration, formatCallTime, recentCallRows } from './format';
import { RecentCallRows } from './recent-call-rows';
import { WrapUpCallSheet } from './wrap-up-sheet';

/**
 * Server-drawn pieces the Dialer console places by selection. They use the calls domain's own
 * wording (`callStatusLabel`), which cannot be imported into the client console itself.
 */

/** A contact's most recent recorded calls, in the calls domain's own wording. */
export function DialerRecentCalls({ organizationId, timeZone, calls }: { organizationId: string; timeZone: string; calls: Call[] }) {
  return <RecentCallRows organizationId={organizationId} rows={recentCallRows(calls, timeZone)} />;
}

/**
 * Answered calls nobody has written up yet, each with the same wrap-up drawer the history uses,
 * and the way to the rest. A true zero says so once.
 */
export function DialerWrapUp({ organizationId, timeZone, calls, total, outcomes, href }: {
  organizationId: string;
  timeZone: string;
  calls: Call[];
  total: number;
  outcomes: CallOutcome[];
  href: string;
}) {
  if (!calls.length) return <PanelState>Every answered call has an outcome.</PanelState>;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border">
        {calls.map((call) => (
          <li key={call.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              <Link href={`/organizations/${organizationId}/calls/${call.id}`} className="block truncate text-sm font-medium hover:underline">{callerName(call)}</Link>
              <span className="block text-xs text-muted tabular-nums">{formatCallTime(call.startedAt, timeZone)} · {formatCallDuration(call.durationSeconds)}</span>
            </span>
            <WrapUpCallSheet organizationId={organizationId} call={call} outcomes={outcomes} />
          </li>
        ))}
      </ul>
      {total > calls.length ? <ButtonLink href={href} tone="secondary" size="small" scroll={false}>All {total} calls to wrap up</ButtonLink> : null}
    </div>
  );
}
