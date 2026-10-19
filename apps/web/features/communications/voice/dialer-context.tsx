import Link from 'next/link';
import { PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { PanelState, StatePill } from '@/components/operational/primitives';
import { FOCUS_RING, cx } from '@/components/class-names';
import { callStatusLabel, type Call } from '@/lib/domain/reception/calls';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import { callerName, callStatusTone, formatCallDuration, formatCallTime } from './format';
import { WrapUpCallSheet } from './wrap-up-sheet';

/**
 * Server-drawn pieces the Dialer console places by selection. They use the calls domain's own
 * wording (`callStatusLabel`), which cannot be imported into the client console itself.
 */

/** A customer's most recent recorded calls, newest first, each linked to its call record. */
export function DialerRecentCalls({ organizationId, timeZone, calls }: { organizationId: string; timeZone: string; calls: Call[] }) {
  if (!calls.length) return <p className="text-sm text-muted">No recorded calls with this customer yet.</p>;
  return (
    <ol className="space-y-1">
      {calls.map((call) => {
        const Icon = call.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing;
        return (
          <li key={call.id}>
            <Link href={`/organizations/${organizationId}/calls/${call.id}`} className={cx('-mx-2 flex items-start gap-3 rounded-md px-2 py-2 hover:bg-hover', FOCUS_RING)}>
              <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-muted"><Icon aria-hidden className="size-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{call.direction === 'inbound' ? 'Inbound call' : 'Outbound call'}</span>
                  <StatePill tone={callStatusTone(call)}>{callStatusLabel(call)}</StatePill>
                </span>
                <span className="block text-xs text-muted tabular-nums">
                  {formatCallTime(call.startedAt, timeZone)}{call.answeredAt ? ` · ${formatCallDuration(call.durationSeconds)}` : ''}{call.outcome ? ` · ${call.outcome.name}` : ''}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
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
