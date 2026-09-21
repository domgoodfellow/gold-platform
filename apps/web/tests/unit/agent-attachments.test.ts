import { describe, expect, it } from 'vitest';
import { attachmentDescription, attachmentKindLabel, formatBytes } from '@/features/agent/attachment-view';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TEXT_MAX_CHARS,
  ATTACHMENTS_TEXT_MAX_CHARS,
  boundAttachmentTexts,
  decodeText,
  safeAttachmentName,
  validateAttachment,
} from '@/lib/domain/assistant/attachment-rules';

describe('validateAttachment — a file is refused before a byte is sent', () => {
  it('accepts the four text types and stores each by its extension, not the browser’s word', () => {
    expect(validateAttachment({ name: 'a.txt', size: 5 })).toEqual({ error: null, mimeType: 'text/plain', fileName: 'a.txt' });
    expect(validateAttachment({ name: 'a.MD', size: 5 })).toMatchObject({ mimeType: 'text/markdown' });
    expect(validateAttachment({ name: 'a.csv', size: 5 })).toMatchObject({ mimeType: 'text/csv' });
    expect(validateAttachment({ name: 'a.json', size: 5 })).toMatchObject({ mimeType: 'application/json' });
  });

  it('refuses what nothing here can read', () => {
    for (const name of ['a.pdf', 'a.png', 'a.docx', 'a.exe', 'noextension', '.csv']) {
      expect(validateAttachment({ name, size: 5 }).error).toMatch(/cannot read that kind of file/);
    }
  });

  it('refuses empty, and over the limit', () => {
    expect(validateAttachment({ name: 'a.txt', size: 0 }).error).toMatch(/empty/);
    expect(validateAttachment({ name: 'a.txt', size: ATTACHMENT_MAX_BYTES + 1 }).error).toMatch(/larger than/);
    expect(validateAttachment({ name: 'a.txt', size: ATTACHMENT_MAX_BYTES }).error).toBeNull();
  });

  it('offers the picker exactly the accepted extensions', () => {
    expect(ATTACHMENT_ACCEPT.split(',').sort()).toEqual(['.csv', '.json', '.markdown', '.md', '.txt']);
  });
});

describe('safeAttachmentName — a name is data, never a path', () => {
  it('drops directories, control characters and direction overrides', () => {
    expect(safeAttachmentName('../../etc/passwd')).toBe('passwd');
    expect(safeAttachmentName('C:\\Users\\me\\notes.txt')).toBe('notes.txt');
    expect(safeAttachmentName('re\u202Egpj.txt')).toBe('regpj.txt');
    expect(safeAttachmentName('a\u0000b\n c.txt')).toBe('ab c.txt');
  });

  it('shortens a long name from the middle so the extension survives', () => {
    const name = safeAttachmentName(`${'x'.repeat(300)}.csv`);
    expect(Array.from(name).length).toBeLessThanOrEqual(120);
    expect(name.endsWith('….csv')).toBe(true);
  });
});

describe('decodeText — only text is ever sent to a model', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);

  it('reads UTF-8 and strips a byte-order mark', () => {
    expect(decodeText(bytes('héllo ✓'))).toBe('héllo ✓');
    expect(decodeText(bytes('\ufeffa,b'))).toBe('a,b');
  });

  it('refuses binary: a NUL byte, or an invalid sequence', () => {
    expect(decodeText(new Uint8Array([0x50, 0x4b, 0x00, 0x01]))).toBeNull();
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0xfa]))).toBeNull();
  });
});

describe('boundAttachmentTexts', () => {
  const file = (text: string) => ({ name: 'a.txt', mimeType: 'text/plain', text, truncated: false });

  it('leaves a short file whole', () => {
    expect(boundAttachmentTexts([file('hi')])).toEqual([file('hi')]);
  });

  it('shortens one long file, and says so', () => {
    const [bounded] = boundAttachmentTexts([file('x'.repeat(ATTACHMENT_TEXT_MAX_CHARS + 5))]);
    expect(bounded.text).toHaveLength(ATTACHMENT_TEXT_MAX_CHARS);
    expect(bounded.truncated).toBe(true);
  });

  it('keeps the whole within one budget, first files whole', () => {
    const files = [1, 2, 3].map(() => file('x'.repeat(ATTACHMENT_TEXT_MAX_CHARS)));
    const bounded = boundAttachmentTexts(files);
    expect(bounded.reduce((sum, f) => sum + f.text.length, 0)).toBeLessThanOrEqual(ATTACHMENTS_TEXT_MAX_CHARS);
    expect(bounded[0].truncated).toBe(false);
    expect(bounded[2].truncated).toBe(true);
  });
});

describe('what a card says about a file', () => {
  it('names the kind and a readable size', () => {
    expect(attachmentKindLabel('text/csv')).toBe('CSV');
    expect(attachmentKindLabel('application/x-anything')).toBe('File');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(1024 * 1024 * 1.5)).toBe('1.5 MB');
    expect(attachmentDescription('text/csv', 12 * 1024)).toBe('CSV · 12 KB');
  });
});
