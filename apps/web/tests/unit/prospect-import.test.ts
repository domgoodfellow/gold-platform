import { describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/domain/files/parsers/csv';
import { importValue, normalizeImportRow, suggestMapping } from '@/lib/domain/integrations/mappings';
import { sourceRowsForImport } from '@/lib/domain/integrations/import-runs';

describe('prospect source intake', () => {
  it('retains more than 5,000 rows without truncation', () => {
    const parsed = parseCsv(['name,email', ...Array.from({ length: 5001 }, (_, i) => `Business ${i},`)].join('\n'));
    expect(parsed.rows).toHaveLength(5001);
    expect(parsed.totalRows).toBe(5001);
    expect(parsed.truncated).toBe(false);
  });
  it('refuses malformed rows rather than shifting source columns', () => {
    expect(() => parseCsv('name,email\nBusiness,a@example.test,extra')).toThrow();
  });
  it('accepts a single-column CSV', () => {
    expect(parseCsv('name\nBusiness\n').rows).toEqual([{ name: 'Business' }]);
  });
  it('normalizes missing email and literal nulls without inventing business names', () => {
    const mapping = suggestMapping(['name', 'email', 'phone', 'province'], []);
    expect(normalizeImportRow(mapping, [], { name: 'Business', email: 'null', phone: '14165551234', province: 'ON' })).toMatchObject({
      normalized: { name: 'Business', email: null, phone: '+14165551234', location: { province: 'ON', city: null, address: null } }, validationErrors: [],
    });
    expect(normalizeImportRow(mapping, [], { name: 'NULL', email: '', phone: '', province: 'null' }).validationErrors).not.toHaveLength(0);
    expect(importValue(undefined)).toBe('');
  });
  it('keeps source identity stable across reordered rows and scopes it to the source filename', () => {
    const rows = [{ source_record_id: '42', name: 'Business' }, { source_record_id: '43', name: 'Other' }];
    const first = sourceRowsForImport(rows, 'leads.csv');
    expect(sourceRowsForImport([...rows].reverse(), 'leads.csv')[1].key).toBe(first[0].key);
    expect(sourceRowsForImport(rows, 'unrelated.csv')[0].key).not.toBe(first[0].key);
    expect(sourceRowsForImport([{ name: 'Business', phone: '' }], 'leads.csv')[0].key)
      .toBe(sourceRowsForImport([{ phone: '', name: 'Business' }], 'leads.csv')[0].key);
  });
});

describe('contact classification intake', () => {
  it('maps lifecycle and temperature independently and reports invalid values', () => {
    const mapping = suggestMapping(['name','lifecycle','temperature'], []);
    expect(normalizeImportRow(mapping, [], {name:'Lead',lifecycle:'Prospect',temperature:'HOT'})).toMatchObject({normalized:{lifecycle:'prospect',lead_temperature:'hot'},validationErrors:[]});
    expect(normalizeImportRow(mapping, [], {name:'Invalid',lifecycle:'won',temperature:'urgent'}).validationErrors).toHaveLength(2);
    expect(normalizeImportRow(suggestMapping(['name'],[]), [], {name:'No classification'}).normalized).not.toHaveProperty('lifecycle');
  });
  it('uses provider identity even when mapped contact values change', () => {
    const old = sourceRowsForImport([{__source_record_id:'row-42', name:'Before'}], 'resource-1');
    const next = sourceRowsForImport([{__source_record_id:'row-42', name:'After'}], 'resource-1');
    expect(next[0].key).toBe(old[0].key);
    expect(sourceRowsForImport([{__source_record_id:'row-42',name:'After'}], 'resource-2')[0].key).not.toBe(old[0].key);
  });
});
