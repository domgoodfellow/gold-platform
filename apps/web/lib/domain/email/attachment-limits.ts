/**
 * What an email may carry, written once and importable anywhere — no server code behind it, so the
 * composer can tell a person before they press Send what the database would refuse after.
 *
 * The database holds the same numbers (`queue_outbound_email`) and is the one that decides; this is the
 * courtesy that produces a sentence. A mismatch fails there first.
 */
export const MAX_ATTACHMENTS = 10;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 25 * 1024 * 1024;

/** Executable and script types no business sends on purpose and a recipient's mail system would refuse anyway. */
const BLOCKED_EXTENSIONS = new Set(['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'js', 'jse', 'vbs', 'vbe', 'wsf', 'ps1', 'jar', 'lnk']);

/** Pure: whether a set of files may be sent on one email, with the sentence to show if not. */
export function validateOutboundAttachments(files: { name: string; size: number }[]): string | null {
  if (files.length > MAX_ATTACHMENTS) return `An email carries at most ${MAX_ATTACHMENTS} attachments.`;
  let total = 0;
  for (const file of files) {
    if (file.size <= 0) return `"${file.name}" is empty.`;
    if (file.size > MAX_ATTACHMENT_BYTES) return `"${file.name}" is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`;
    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (BLOCKED_EXTENSIONS.has(extension)) return `"${file.name}" is a type of file email will not carry.`;
    total += file.size;
  }
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) return `The attachments together are larger than ${MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024)} MB.`;
  return null;
}
