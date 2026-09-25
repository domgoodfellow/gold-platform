import { describe, expect, it } from 'vitest';
import {
  FILE_FORMATS,
  acceptFor,
  formatsFor,
  identifyFormat,
  isParseable,
  isUploadable,
} from '@/lib/domain/files/formats';
import { checkFileIntake } from '@/lib/domain/files/intake';
import { PLATFORM_FILE_POLICY, type FileIngestionPolicy } from '@/lib/domain/files/policy';

describe('the format registry keeps four claims apart', () => {
  it('recognizes formats it cannot yet use, without pretending otherwise', () => {
    for (const name of ['a.xlsx', 'a.xls', 'a.xml', 'a.pdf', 'a.docx', 'a.rtf', 'a.pptx', 'a.png', 'a.jpeg', 'a.webp', 'a.svg']) {
      const format = identifyFormat(name);
      expect(format, name).not.toBeNull();
      expect(isParseable(format!), name).toBe(false);
      expect(isUploadable(format!), name).toBe(false);
    }
  });

  it('says exactly which formats the CRM import and the Agent read', () => {
    expect(formatsFor('crm_import').map((f) => f.id)).toEqual(['csv']);
    expect(formatsFor('agent_attachment').map((f) => f.id).sort()).toEqual(['csv', 'json', 'md', 'txt']);
    expect(acceptFor('crm_import')).toBe('.csv');
  });

  it('never lists a consumer for a format nothing can read', () => {
    for (const format of FILE_FORMATS) {
      if (format.consumers.length > 0) expect(isParseable(format), format.id).toBe(true);
    }
  });

  it('identifies by extension, case-insensitively, and never by a bare dot', () => {
    expect(identifyFormat('LEADS.CSV')?.id).toBe('csv');
    expect(identifyFormat('notes.markdown')?.id).toBe('md');
    expect(identifyFormat('photo.JPG')?.id).toBe('jpg');
    expect(identifyFormat('.csv')).toBeNull();
    expect(identifyFormat('noextension')).toBeNull();
    expect(identifyFormat('a.exe')).toBeNull();
  });
});

describe('checkFileIntake', () => {
  it('admits a CSV for the CRM import as the one stored type, whatever the browser said', () => {
    const result = checkFileIntake({ name: 'leads.csv', size: 10 }, { consumer: 'crm_import' });
    expect(result).toMatchObject({ ok: true, artifact: { name: 'leads.csv', mimeType: 'text/csv', size: 10 } });
  });

  it('refuses a recognized file the consumer cannot read — a PDF is not a CRM import', () => {
    expect(checkFileIntake({ name: 'a.pdf', size: 10 }, { consumer: 'crm_import' })).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(checkFileIntake({ name: 'a.json', size: 10 }, { consumer: 'crm_import' })).toMatchObject({ ok: false, reason: 'unsupported' });
  });

  it('refuses empty, nameless and oversize files, and lets a consumer be stricter than policy', () => {
    expect(checkFileIntake({ name: 'a.csv', size: 0 }, { consumer: 'crm_import' })).toMatchObject({ ok: false, reason: 'empty' });
    expect(checkFileIntake({ name: '   ', size: 5 }, { consumer: 'crm_import' })).toMatchObject({ ok: false, reason: 'no_name' });
    const over = 25 * 1024 * 1024 + 1;
    expect(checkFileIntake({ name: 'a.csv', size: over }, { consumer: 'crm_import' })).toMatchObject({ ok: false, reason: 'too_large' });
    expect(checkFileIntake({ name: 'a.csv', size: 2048 }, { consumer: 'crm_import', maxBytes: 1024 })).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('never lets a consumer raise the organization limit', () => {
    const small: FileIngestionPolicy = { ...PLATFORM_FILE_POLICY, maxFileSizeMb: 1 };
    const result = checkFileIntake({ name: 'a.csv', size: 2 * 1024 * 1024 }, { consumer: 'crm_import', policy: small, maxBytes: 100 * 1024 * 1024 });
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
  });
});

describe('organization policy is separate from what a parser can do', () => {
  it('refuses everything when file ingestion is off', () => {
    const off: FileIngestionPolicy = { ...PLATFORM_FILE_POLICY, enabled: false };
    expect(checkFileIntake({ name: 'a.csv', size: 5 }, { consumer: 'crm_import', policy: off })).toMatchObject({ ok: false, reason: 'disabled' });
  });

  it('admits by category, or by an explicit MIME type beside the categories', () => {
    const documentsOnly: FileIngestionPolicy = { ...PLATFORM_FILE_POLICY, allowedCategories: ['document'] };
    expect(checkFileIntake({ name: 'a.csv', size: 5 }, { consumer: 'crm_import', policy: documentsOnly })).toMatchObject({ ok: false, reason: 'disabled' });
    expect(checkFileIntake({ name: 'a.md', size: 5 }, { consumer: 'agent_attachment', policy: documentsOnly })).toMatchObject({ ok: true });

    const csvByType: FileIngestionPolicy = { ...documentsOnly, allowedMimeTypes: ['text/csv'] };
    expect(checkFileIntake({ name: 'a.csv', size: 5 }, { consumer: 'crm_import', policy: csvByType })).toMatchObject({ ok: true });
  });

  it('cannot admit a format no consumer reads, however permissive the policy', () => {
    expect(checkFileIntake({ name: 'a.pdf', size: 5 }, { consumer: 'agent_attachment', policy: PLATFORM_FILE_POLICY })).toMatchObject({ ok: false, reason: 'unsupported' });
  });
});
