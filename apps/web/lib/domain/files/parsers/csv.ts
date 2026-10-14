import Papa from 'papaparse';
import { DomainError } from '@/lib/domain/errors';

/**
 * The one place this platform parses a CSV. Papaparse rather than a hand-rolled split on `,` —
 * quoting, embedded commas and embedded newlines are exactly the cases a hand-rolled parser gets
 * wrong on a real export, silently, which is worse than not parsing at all.
 */

export type ParsedCsv = {
  headers: string[];
  /** Every row, each keyed by header. */
  rows: Record<string, string>[];
  /** The first few rows, for a preview. */
  sample: Record<string, string>[];
  totalRows: number;
  truncated: boolean;
};

const SAMPLE_SIZE = 5;

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = result.meta.fields ?? [];
  if (headers.length === 0) {
    throw new DomainError('That file has no header row GildOps could read.', 'integrations.csv_no_headers');
  }
  if (result.errors.some((error) => error.code !== 'UndetectableDelimiter')) {
    throw new DomainError('The CSV has malformed rows. Correct its columns or quoting before importing.', 'integrations.csv_invalid');
  }

  const totalRows = result.data.length;

  return {
    headers,
    rows: result.data,
    sample: result.data.slice(0, SAMPLE_SIZE),
    totalRows,
    truncated: false,
  };
}
