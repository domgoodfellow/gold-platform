import { acceptFor, fileExtension } from '@/lib/domain/files/formats';
import { checkFileIntake, safeFileName } from '@/lib/domain/files/intake';
import { decodeText } from '@/lib/domain/files/parsers/text';

/**
 * What an Agent attachment may be, as pure rules: no database, no storage, no Node — so the composer
 * can refuse a file at once and the server can refuse it again, from the same words. The supported
 * set is the file registry's `agent_attachment` consumer; the reasoning for text only is in
 * `attachments.ts`.
 */

/** For the file picker's `accept`. */
export const ATTACHMENT_ACCEPT = acceptFor('agent_attachment');

/** A person-facing name for what is accepted. */
export const ATTACHMENT_KINDS_LABEL = 'Text, Markdown, CSV or JSON';

export const ATTACHMENT_MAX_BYTES = 1024 * 1024;
export const ATTACHMENTS_PER_QUESTION = 3;

/** How much of one file, and of all of them, reaches the model. Bounded again in `apps/api`. */
export const ATTACHMENT_TEXT_MAX_CHARS = 20_000;
export const ATTACHMENTS_TEXT_MAX_CHARS = 40_000;

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

export { safeFileName as safeAttachmentName, fileExtension as attachmentExtension };

/**
 * The refusal for a file, before any byte is sent — or null, with the type it will be stored as.
 * Used by the browser to say no at once and by the server to say it again, since the browser is
 * not the boundary.
 */
export function validateAttachment(file: {
  name: string;
  size: number;
}): { error: string } | { error: null; mimeType: string; fileName: string } {
  const checked = checkFileIntake(file, { consumer: 'agent_attachment', maxBytes: ATTACHMENT_MAX_BYTES });
  if (checked.ok) return { error: null, mimeType: checked.artifact.mimeType, fileName: checked.artifact.name };
  if (checked.reason === 'unsupported') {
    return { error: `${ATTACHMENT_KINDS_LABEL} only. The Agent cannot read that kind of file yet.` };
  }
  return { error: checked.message };
}

export { decodeText };

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
