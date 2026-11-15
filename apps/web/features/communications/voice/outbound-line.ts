import { formatPhoneForDisplay } from '@/lib/display/phone';
import type { OutboundLine } from '@/lib/application/communications/calling-options';

/**
 * The words for an outbound line, shared by the Dialer and the pop-out window so the two never
 * describe one choice two ways. Nothing here chooses a number: the server resolves it, and these
 * say what it resolved and why.
 */

/** Why Automatic uses the number it does, by the reason the server gives. */
export const AUTOMATIC_REASON: Record<OutboundLine['source'], string> = {
  preference: 'The number you chose to call from',
  member_default: 'Your default number',
  member: 'Selected from your assigned numbers',
  organization_default: 'The business’s default number',
  shared: 'Selected from the shared numbers',
};

export const LINE_GROUP_LABEL: Record<OutboundLine['group'], string> = {
  assigned: 'Your numbers',
  shared: 'Shared numbers',
};

/** A number with the business's own name for it, when it has one. */
export function lineLabel(line: Pick<OutboundLine, 'e164' | 'label'>): string {
  return line.label ? `${line.label} · ${formatPhoneForDisplay(line.e164)}` : formatPhoneForDisplay(line.e164);
}
