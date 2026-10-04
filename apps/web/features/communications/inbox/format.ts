/** Small presentation helpers shared by the Inbox screens. No rule lives here — only words and shapes. */

export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * One truthful word per message state, the same for both channels. `queued` is *not sent*: the message
 * exists and has not left, which is different from `sending` and from the provider having taken it.
 */
export const STATUS_LABEL: Record<string, string> = {
  queued: 'Not sent yet',
  sending: 'Sending…',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  rejected: 'Rejected',
  bounced: 'Bounced',
  undelivered: 'Not delivered',
};

export const PROBLEM_STATUSES = new Set(['failed', 'rejected', 'bounced', 'undelivered']);

export const CONVERSATION_STATUS_LABEL = { open: 'Open', waiting: 'Waiting', closed: 'Closed' } as const;

/** The change event the detail screen raises when something an open Inbox list shows may have changed. */
export const INBOX_CHANGED = 'inbox:changed';
export const announceInboxChange = () => window.dispatchEvent(new Event(INBOX_CHANGED));
