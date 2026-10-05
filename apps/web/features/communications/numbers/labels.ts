import type { NumberPurpose, NumberReadiness, PhoneNumber, PhoneNumberOrigin } from '@/lib/domain/reception/numbers';

/** The words a business sees for what a number is and whether it works — never a carrier's. */

export const READINESS_LABEL: Record<NumberReadiness, string> = {
  ready: 'Ready',
  setup_required: 'Setup required',
  degraded: 'Degraded',
  unavailable: 'Unavailable',
};

export const READINESS_TONE: Record<NumberReadiness, 'success' | 'neutral' | 'danger'> = {
  ready: 'success',
  setup_required: 'neutral',
  degraded: 'danger',
  unavailable: 'danger',
};

export const READINESS_EXPLANATION: Record<NumberReadiness, string> = {
  ready: 'Calls and texts can use this number now.',
  setup_required: 'GildOps is still setting this number up. It cannot be used yet.',
  degraded: 'The carrier is reporting a problem with this number. Contact support if it does not clear.',
  unavailable: 'This number is switched off or has been taken out of service.',
};

export const PURPOSE_LABEL: Record<NumberPurpose, string> = {
  general: 'General',
  main: 'Main line',
  reception: 'Reception',
  sales: 'Sales',
  support: 'Support',
};

/** What each origin means a business can do with the number, said plainly rather than left to be inferred. */
export const ORIGIN_LABEL: Record<PhoneNumberOrigin, string> = {
  provisioned: 'Provided by GildOps',
  external: 'Your own number',
  browser: 'Browser',
  sip: 'SIP',
};

export const ORIGIN_EXPLANATION: Record<PhoneNumberOrigin, string> = {
  provisioned: 'GildOps holds this number, so it can take calls and texts and place them.',
  external: 'A number you already owned. It can show as your caller id on outbound calls where the carrier permits; GildOps does not receive calls or texts sent to it.',
  browser: 'An internal calling endpoint, never shown as a public number.',
  sip: 'Reserved. Nothing in GildOps uses a SIP number yet.',
};

export function capabilitySummary(number: Pick<PhoneNumber, 'voiceInboundEnabled' | 'voiceOutboundEnabled' | 'smsInboundEnabled' | 'smsOutboundEnabled'>): string[] {
  const words: string[] = [];
  if (number.voiceInboundEnabled) words.push('Takes calls');
  if (number.voiceOutboundEnabled) words.push('Places calls');
  if (number.smsInboundEnabled) words.push('Takes texts');
  if (number.smsOutboundEnabled) words.push('Sends texts');
  return words;
}
