import Link from 'next/link';
import type { ReactNode } from 'react';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import { callStatusLabel, type Call } from '@/lib/domain/reception/calls';
import { callerName, callStatusTone, formatCallDuration, formatCallTime } from './format';

/**
 * The canonical responsive rendering of call history — the Calls workspace, the customer's own
 * calls and the overview all draw it, so a call looks the same wherever it is met. A row is one
 * business call: who it was with, which way, what happened, which of the business's numbers it
 * was on, when and for how long. Nothing the carrier calls anything reaches it.
 */
export function CallHistory({
  organizationId,
  timeZone,
  calls,
  numbers,
  renderWrapUp,
  empty = 'No calls recorded.',
}: {
  organizationId: string;
  timeZone: string;
  calls: Call[];
  /** The business's numbers by id, to say which one a call was on in the business's own words. */
  numbers?: Map<string, { e164: string; label: string | null }>;
  renderWrapUp?: (call: Call) => ReactNode;
  empty?: ReactNode;
}) {
  const businessNumber = (call: Call) => {
    const e164 = call.direction === 'outbound' ? call.fromNumber : call.toNumber;
    const known = call.phoneNumberId ? numbers?.get(call.phoneNumberId) : undefined;
    return known?.label ?? known?.e164 ?? e164 ?? '—';
  };

  return (
    <DataTable
      rows={calls}
      rowKey={(call) => call.id}
      empty={empty}
      columns={[
        {
          key: 'caller',
          header: 'Caller',
          emphasis: 'primary',
          cell: (call) => (
            <>
              <Link href={`/organizations/${organizationId}/calls/${call.id}`} className="underline underline-offset-4">
                {callerName(call)}
              </Link>
              <span className="mt-0.5 block text-xs font-normal text-subtle">
                {call.direction === 'inbound' ? 'Inbound' : 'Outbound'}
                {call.customerName === null && call.externalNumber !== null ? ' · Unknown caller' : ''}
              </span>
            </>
          ),
        },
        { key: 'status', header: 'Status', cell: (call) => <Badge tone={callStatusTone(call)}>{callStatusLabel(call)}</Badge> },
        { key: 'number', header: 'On', cell: businessNumber },
        {
          key: 'started',
          header: 'When',
          cell: (call) => (
            <>
              {formatCallTime(call.startedAt, timeZone)}
              {call.answeredAt ? <span className="ml-2 text-xs text-subtle tabular-nums">{formatCallDuration(call.durationSeconds)}</span> : null}
            </>
          ),
        },
        { key: 'handledBy', header: 'Handled by', emphasis: 'secondary', cell: (call) => call.handledBy.map((member) => member.name).join(', ') || '—' },
        { key: 'outcome', header: 'Outcome', cell: (call) => call.outcome?.name ?? <span className="text-subtle">Not written up</span> },
      ]}
      actions={renderWrapUp}
    />
  );
}
