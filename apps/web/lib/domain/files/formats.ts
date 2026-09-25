/**
 * Which file formats this platform knows about, and what it does with each.
 *
 * A file is an artifact somebody hands GOLD. It is never a Connection: nothing here is authorized,
 * configured or synced. Four different claims are kept apart, because each is a different thing to
 * be wrong about:
 *
 *   recognized  — the format is in this table
 *   parseable   — `parser` names a reader that exists in `./parsers`
 *   uploadable  — some consumer stores this format (derived: it lists at least one)
 *   usable by X — that consumer lists it
 *
 * The last two are derived from `consumers`, never a flag beside it, so they cannot disagree. A
 * format joins a consumer the day the reader that consumer needs exists, and not before (D31): a PDF
 * being recognized is not a promise that a CRM import can read one.
 */

export const FILE_CATEGORIES = ['structured-data', 'document', 'presentation', 'image'] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

/** The operations that consume a file. Each one names the formats it can actually use. */
export type FileConsumer = 'crm_import' | 'agent_attachment';

/** A reader in `./parsers`. `text` is a strict UTF-8 decode; `csv` is the header-row parser. */
export type FileParser = 'csv' | 'text';

export type FileFormat = {
  id: string;
  label: string;
  /** Lower case, without the dot. */
  extensions: readonly string[];
  /** The one MIME type stored for the format. The browser's own `type` is a hint and is not trusted. */
  mimeType: string;
  category: FileCategory;
  parser: FileParser | null;
  consumers: readonly FileConsumer[];
};

const recognized = (
  id: string,
  label: string,
  extensions: string[],
  mimeType: string,
  category: FileCategory,
): FileFormat => ({ id, label, extensions, mimeType, category, parser: null, consumers: [] });

export const FILE_FORMATS: readonly FileFormat[] = [
  { id: 'csv', label: 'CSV', extensions: ['csv'], mimeType: 'text/csv', category: 'structured-data', parser: 'csv', consumers: ['crm_import', 'agent_attachment'] },
  { id: 'json', label: 'JSON', extensions: ['json'], mimeType: 'application/json', category: 'structured-data', parser: 'text', consumers: ['agent_attachment'] },
  { id: 'txt', label: 'Text', extensions: ['txt'], mimeType: 'text/plain', category: 'document', parser: 'text', consumers: ['agent_attachment'] },
  { id: 'md', label: 'Markdown', extensions: ['md', 'markdown'], mimeType: 'text/markdown', category: 'document', parser: 'text', consumers: ['agent_attachment'] },

  recognized('xlsx', 'Excel workbook', ['xlsx'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'structured-data'),
  recognized('xls', 'Excel 97-2003 workbook', ['xls'], 'application/vnd.ms-excel', 'structured-data'),
  recognized('xml', 'XML', ['xml'], 'application/xml', 'structured-data'),
  recognized('pdf', 'PDF', ['pdf'], 'application/pdf', 'document'),
  recognized('docx', 'Word document', ['docx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'),
  recognized('rtf', 'Rich text', ['rtf'], 'application/rtf', 'document'),
  recognized('pptx', 'PowerPoint presentation', ['pptx'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'presentation'),
  recognized('png', 'PNG image', ['png'], 'image/png', 'image'),
  recognized('jpg', 'JPEG image', ['jpg', 'jpeg'], 'image/jpeg', 'image'),
  recognized('webp', 'WebP image', ['webp'], 'image/webp', 'image'),
  recognized('svg', 'SVG image', ['svg'], 'image/svg+xml', 'image'),
];

/** The extension of a file name, lower case and without the dot. A leading dot is a name, not an extension. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The format a file name says it is, or null if the platform has never heard of it. */
export function identifyFormat(name: string): FileFormat | null {
  const extension = fileExtension(name);
  if (!extension) return null;
  return FILE_FORMATS.find((format) => format.extensions.includes(extension)) ?? null;
}

export function isParseable(format: FileFormat): boolean {
  return format.parser !== null;
}

/** Whether some consumer stores this format. */
export function isUploadable(format: FileFormat): boolean {
  return format.consumers.length > 0;
}

export function formatsFor(consumer: FileConsumer): FileFormat[] {
  return FILE_FORMATS.filter((format) => format.consumers.includes(consumer));
}

/** For a file picker's `accept`. */
export function acceptFor(consumer: FileConsumer): string {
  return formatsFor(consumer)
    .flatMap((format) => format.extensions.map((extension) => `.${extension}`))
    .join(',');
}
