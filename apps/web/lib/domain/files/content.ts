import type { FileFormat } from './formats';

/**
 * Whether a file's bytes are the kind its name claims. The name and the browser's type both come
 * from whoever sent the file, so a stored file is checked against its first bytes before it is kept.
 *
 * Binary formats are matched on their signature. Text formats must decode as UTF-8 and contain no
 * NUL byte, which is what a renamed binary almost always has. Formats not listed here are refused:
 * a format nobody has described a signature for cannot be checked, so it is not accepted.
 */

const SIGNATURES: Readonly<Record<string, readonly number[]>> = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpg: [0xff, 0xd8, 0xff],
  // Office Open XML formats are zip containers; the zip signature alone does not prove the kind.
  docx: [0x50, 0x4b, 0x03, 0x04],
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  pptx: [0x50, 0x4b, 0x03, 0x04],
  xls: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  rtf: [0x7b, 0x5c, 0x72, 0x74, 0x66],
};

const TEXT_FORMATS: ReadonlySet<string> = new Set(['csv', 'json', 'txt', 'md', 'xml']);

export function contentMatchesFormat(bytes: Uint8Array, format: FileFormat): boolean {
  if (format.id === 'webp') {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8);
  }
  const signature = SIGNATURES[format.id];
  if (signature) return startsWith(bytes, signature);
  if (TEXT_FORMATS.has(format.id)) return isUtf8Text(bytes);
  return false;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}
