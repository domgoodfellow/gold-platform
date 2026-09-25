import { identifyFormat, type FileConsumer, type FileFormat } from './formats';
import { PLATFORM_FILE_POLICY, policyAllows, policyMaxBytes, type FileIngestionPolicy } from './policy';

/**
 * What every consumer asks first of a file, as pure rules: no database, no storage, no Node — so a
 * browser can refuse a file at once and the server can refuse it again from the same words.
 *
 *   intake → validate → (the owner stores it) → identify → hand to a parser or consumer
 *
 * Storing stays with the owner of the file — a `documents` row, an import resource — because who
 * owns the bytes is a different question from whether they may come in. This layer knows no CRM
 * schema, no agent and no connection.
 */

/** A file as intake sees it. Where it is stored is the owner's business. */
export type FileArtifact = {
  name: string;
  mimeType: string;
  size: number;
  format: FileFormat;
};

export type IntakeRefusal = 'no_name' | 'unsupported' | 'disabled' | 'empty' | 'too_large';

export type IntakeResult =
  | { ok: true; artifact: FileArtifact }
  | { ok: false; reason: IntakeRefusal; message: string };

const NAME_MAX = 120;

/**
 * A name that is safe to store, show and put in a prompt: no path, no control or direction-changing
 * character, whitespace collapsed, and shortened from the middle so the extension survives.
 */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // Control characters and the bidirectional overrides that make `fdp.exe` read `exe.pdf`.
    .replace(/[\u0000-\u001f​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (Array.from(cleaned).length <= NAME_MAX) return cleaned;

  const dot = cleaned.lastIndexOf('.');
  const extension = dot > 0 ? cleaned.slice(dot) : '';
  const stem = Array.from(cleaned.slice(0, dot > 0 ? dot : undefined));
  return `${stem.slice(0, NAME_MAX - 1 - extension.length).join('')}…${extension}`;
}

/** A storage key segment: keeps keys predictable and stops a `/` in a name splitting into two. */
export function storageKeySegment(name: string, fallback = 'file'): string {
  return name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || fallback;
}

/**
 * The refusal for a file, or the artifact it is. `maxBytes` is the consumer's own ceiling, applied
 * beneath the organization's — a consumer can be stricter than policy, never looser.
 */
export function checkFileIntake(
  file: { name: string; size: number },
  options: { consumer: FileConsumer; policy?: FileIngestionPolicy; maxBytes?: number },
): IntakeResult {
  const policy = options.policy ?? PLATFORM_FILE_POLICY;

  const name = safeFileName(file.name);
  if (!name) return { ok: false, reason: 'no_name', message: 'That file has no name.' };

  const format = identifyFormat(name);
  if (!format || !format.consumers.includes(options.consumer)) {
    return { ok: false, reason: 'unsupported', message: 'That kind of file is not accepted here.' };
  }
  if (!policyAllows(policy, format)) {
    return { ok: false, reason: 'disabled', message: 'Your organization does not accept that kind of file.' };
  }

  if (file.size === 0) return { ok: false, reason: 'empty', message: 'That file is empty.' };

  const limit = Math.min(policyMaxBytes(policy), options.maxBytes ?? Infinity);
  if (file.size > limit) {
    return { ok: false, reason: 'too_large', message: `That file is larger than ${limit / (1024 * 1024)} MB.` };
  }

  return { ok: true, artifact: { name, mimeType: format.mimeType, size: file.size, format } };
}
