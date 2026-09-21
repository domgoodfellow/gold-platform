/** How an attachment is described on a card: its kind, and a size a person can read at a glance. */

const KINDS: Record<string, string> = {
  'text/plain': 'Text',
  'text/markdown': 'Markdown',
  'text/csv': 'CSV',
  'application/json': 'JSON',
};

export function attachmentKindLabel(mimeType: string): string {
  return KINDS[mimeType] ?? 'File';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The second line of a card for a file that is stored: `CSV · 12 KB`. */
export function attachmentDescription(mimeType: string, sizeBytes: number): string {
  return `${attachmentKindLabel(mimeType)} · ${formatBytes(sizeBytes)}`;
}
