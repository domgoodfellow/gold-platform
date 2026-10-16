import { describe, expect, it } from 'vitest';
import { contentMatchesFormat } from '@/lib/domain/files/content';
import { identifyFormat } from '@/lib/domain/files/formats';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function formatOf(name: string) {
  const format = identifyFormat(name);
  if (!format) throw new Error(`no format for ${name}`);
  return format;
}

describe('contentMatchesFormat', () => {
  it('accepts a PDF only when it begins with the PDF signature', () => {
    expect(contentMatchesFormat(bytesOf('%PDF-1.7\n'), formatOf('a.pdf'))).toBe(true);
    expect(contentMatchesFormat(bytesOf('hello'), formatOf('a.pdf'))).toBe(false);
  });

  it('accepts a PNG and a JPEG by their signatures', () => {
    expect(contentMatchesFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), formatOf('a.png'))).toBe(true);
    expect(contentMatchesFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), formatOf('a.jpg'))).toBe(true);
    expect(contentMatchesFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), formatOf('a.png'))).toBe(false);
  });

  it('accepts a WebP only when RIFF and WEBP are both present', () => {
    const webp = bytesOf('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
    expect(contentMatchesFormat(webp, formatOf('a.webp'))).toBe(true);
    expect(contentMatchesFormat(bytesOf('RIFF\u0000\u0000\u0000\u0000WAVEfmt '), formatOf('a.webp'))).toBe(false);
  });

  it('treats an Office file as a zip container, and a legacy workbook by its OLE header', () => {
    expect(contentMatchesFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]), formatOf('a.docx'))).toBe(true);
    expect(contentMatchesFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]), formatOf('a.xlsx'))).toBe(true);
    expect(contentMatchesFormat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), formatOf('a.xls'))).toBe(true);
  });

  it('accepts text formats only when the bytes decode as UTF-8 with no NUL', () => {
    expect(contentMatchesFormat(bytesOf('a,b\n1,2\n'), formatOf('a.csv'))).toBe(true);
    expect(contentMatchesFormat(bytesOf('{"a":1}'), formatOf('a.json'))).toBe(true);
    expect(contentMatchesFormat(new Uint8Array([0x61, 0x00, 0x62]), formatOf('a.txt'))).toBe(false);
    expect(contentMatchesFormat(new Uint8Array([0xff, 0xfe, 0xfd]), formatOf('a.md'))).toBe(false);
  });

  it('refuses a renamed zip presented as text', () => {
    expect(contentMatchesFormat(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]), formatOf('archive.txt'))).toBe(false);
  });

  it('refuses a format it has no signature for', () => {
    expect(contentMatchesFormat(bytesOf('<svg></svg>'), formatOf('logo.svg'))).toBe(false);
  });
});
