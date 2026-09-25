/**
 * The file's text, or null if the bytes are not text. A NUL byte or an invalid UTF-8 sequence means
 * the file is something else wearing a text extension, and it is refused rather than passed on.
 */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return null;
  }
}
