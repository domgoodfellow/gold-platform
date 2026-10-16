import { describe, expect, it } from 'vitest';
import { fileFamilyLabel, formatFileSize, libraryFileFilter } from '@/lib/domain/documents/library-files';

describe('libraryFileFilter', () => {
  it('reads a view with no words in the URL as the default view', () => {
    expect(libraryFileFilter({})).toEqual({ search: '', family: null, usage: 'any', sort: 'newest', page: 1 });
  });

  it('keeps recognized words and ignores unrecognized ones rather than refusing the page', () => {
    expect(
      libraryFileFilter({ q: '  quote ', family: 'images', usage: 'unused', sort: 'name', page: '3' }),
    ).toEqual({ search: 'quote', family: 'images', usage: 'unused', sort: 'name', page: 3 });

    expect(libraryFileFilter({ family: 'executables', usage: 'everything', sort: 'random', page: '-2' })).toEqual({
      search: '', family: null, usage: 'any', sort: 'newest', page: 1,
    });
  });

  it('takes the first value of a repeated parameter', () => {
    expect(libraryFileFilter({ family: ['images', 'text'] }).family).toBe('images');
  });

  it('caps a long search', () => {
    expect(libraryFileFilter({ q: 'x'.repeat(500) }).search).toHaveLength(120);
  });
});

describe('formatFileSize', () => {
  it('uses decimal units, matching how storage plans are stated', () => {
    expect(formatFileSize(999)).toBe('999 B');
    expect(formatFileSize(1500)).toBe('2 KB');
    expect(formatFileSize(2_500_000)).toBe('2.5 MB');
    expect(formatFileSize(10_000_000_000)).toBe('10.00 GB');
  });
});

describe('fileFamilyLabel', () => {
  it('names the family of a known type and shows any other type as it is', () => {
    expect(fileFamilyLabel('application/pdf')).toBe('Documents');
    expect(fileFamilyLabel('text/csv')).toBe('Spreadsheets');
    expect(fileFamilyLabel('application/x-unknown')).toBe('application/x-unknown');
  });
});
