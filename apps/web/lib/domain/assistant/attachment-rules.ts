/**
 * What an Agent attachment may be, as pure rules: no database, no storage, no Node — so the composer
 * can refuse a file at once and the server can refuse it again, from the same words. The reasoning
 * for the supported set, and for text only, is in `attachments.ts`.
 */

/** Extension → the one MIME type stored for it. The browser's own `type` is a hint and is not trusted. */
const TYPES: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

/** For the file picker's `accept`. */
export const ATTACHMENT_ACCEPT = Object.keys(TYPES).map((extension) => `.${extension}`).join(',');

/** A person-facing name for what is accepted. */
export const ATTACHMENT_KINDS_LABEL = 'Text, Markdown, CSV or JSON';

export const ATTACHMENT_MAX_BYTES = 1024 * 1024;
export const ATTACHMENTS_PER_QUESTION = 3;

/** How much of one file, and of all of them, reaches the model. Bounded again in `apps/api`. */
export const ATTACHMENT_TEXT_MAX_CHARS = 20_000;
export const ATTACHMENTS_TEXT_MAX_CHARS = 40_000;

const NAME_MAX = 120;

/** What the composer and a transcript show of a file. */
export type AgentAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

/** What the answering side is given for one file. */
export type AttachmentText = {
  name: string;
  mimeType: string;
  text: string;
  /** True when the file was longer than what was sent. */
  truncated: boolean;
};

/**
 * A name that is safe to store, show and put in a prompt: no path, no control or direction-changing
 * character, whitespace collapsed, and shortened from the middle so the extension survives.
 */
export function safeAttachmentName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // Control characters and the bidirectional overrides that make `fdp.exe` read `exe.pdf`.
    .replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (Array.from(cleaned).length <= NAME_MAX) return cleaned;

  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 ? cleaned.slice(dot) : '';
  const stem = Array.from(cleaned.slice(0, dot > 0 ? dot : undefined));
  return `${stem.slice(0, NAME_MAX - 1 - extension.length).join('')}…${extension}`;
}

export function attachmentExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * The refusal for a file, before any byte is sent — or null, with the type it will be stored as.
 * Used by the browser to say no at once and by the server to say it again, since the browser is
 * not the boundary.
 */
export function validateAttachment(file: {
  name: string;
  size: number;
}): { error: string } | { error: null; mimeType: string; fileName: string } {
  const fileName = safeAttachmentName(file.name);
  if (!fileName) return { error: 'That file has no name.' };

  const mimeType = TYPES[attachmentExtension(fileName)];
  if (!mimeType) return { error: `${ATTACHMENT_KINDS_LABEL} only. The Agent cannot read that kind of file yet.` };

  if (file.size === 0) return { error: 'That file is empty.' };
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return { error: `That file is larger than ${ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.` };
  }
  return { error: null, mimeType, fileName };
}

/**
 * The file's text, or null if the bytes are not text. A NUL byte or an invalid UTF-8 sequence means
 * the file is something else wearing a text extension, and it is refused rather than sent.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\ufeff/, '');
  } catch {
    return null;
  }
}

/** Shortens each file, then the whole, keeping the first files whole rather than every file thin. */
export function boundAttachmentTexts(files: AttachmentText[]): AttachmentText[] {
  let remaining = ATTACHMENTS_TEXT_MAX_CHARS;
  return files.map((file) => {
    const allowed = Math.max(0, Math.min(ATTACHMENT_TEXT_MAX_CHARS, remaining));
    const characters = Array.from(file.text);
    const cut = characters.length > allowed;
    const text = cut ? characters.slice(0, allowed).join('') : file.text;
    remaining -= Array.from(text).length;
    return { ...file, text, truncated: file.truncated || cut };
  });
}
