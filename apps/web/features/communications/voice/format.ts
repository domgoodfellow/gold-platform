import { formatPhoneForDisplay } from '@/lib/display/phone';
import { callStatusLabel, type Call, type CallDetail } from '@/lib/domain/reception/calls';

/** Small presentation helpers shared by the Calls screens. No rule lives here — only words and shapes. */

export function formatCallTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/** `2m 05s`, `45s`, or a dash when nobody measured. A call that never connected has no length. */
export function formatCallDuration(seconds: number | null): string {
  if (seconds === null) return '—';
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export const PARTY_LABEL = {
  agent: 'Agent',
  customer: 'Caller',
  supervisor: 'Supervisor',
  transfer_target: 'Transfer',
} as const;

/** What to call someone on a call when nobody has named them. */
export const NAMELESS_LABEL = {
  agent: 'A colleague',
  customer: 'The caller',
  supervisor: 'A supervisor',
  transfer_target: 'Transfer destination',
} as const;

/** Who the call was with: the customer's name, else the number, else honesty about not knowing. */
export function callerName(call: Pick<Call, 'customerName' | 'externalNumber'>): string {
  return call.customerName ?? (call.externalNumber ? formatPhoneForDisplay(call.externalNumber) : 'Withheld number');
}

/** The platform's own word for a state it reports; a failure is the only thing coloured. */
export function callStatusTone(call: Pick<Call, 'status' | 'direction'>): 'neutral' | 'success' | 'danger' {
  if (call.status === 'completed' || call.status === 'in_progress') return 'success';
  if (call.status === 'failed' || (call.direction === 'inbound' && call.status !== 'ringing')) return 'danger';
  return 'neutral';
}

export type TimelineEntry = { at: string; text: string };

/**
 * What happened on a call, in order, from the call and its legs: when it began, who joined and
 * left, when it was answered and when it ended. Every line is the business's own vocabulary — a
 * carrier's event names never appear — and a call that nobody joined has just its two ends.
 */
export function callTimeline(call: CallDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = [{ at: call.startedAt, text: call.direction === 'inbound' ? 'Call received' : 'Call started' }];
  for (const leg of call.legs) {
    const who = leg.party === 'customer' ? (call.customerName ?? NAMELESS_LABEL.customer) : (leg.name ?? NAMELESS_LABEL[leg.party]);
    if (leg.joinedAt) entries.push({ at: leg.joinedAt, text: `${who} joined` });
    if (leg.leftAt && leg.joinedAt) entries.push({ at: leg.leftAt, text: `${who} left` });
  }
  if (call.answeredAt) entries.push({ at: call.answeredAt, text: 'Answered' });
  if (call.endedAt) entries.push({ at: call.endedAt, text: call.status === 'completed' ? 'Call ended' : `Call ended — ${callStatusLabel(call).toLowerCase()}` });
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
