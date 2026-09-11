import Papa from 'papaparse';
import { DomainError } from '@/lib/domain/errors';

/**
 * The one place this platform parses a CSV. Papaparse rather than a hand-rolled split on `,` —
 * quoting, embedded commas and embedded newlines are exactly the cases a hand-rolled parser gets
 * wrong on a real export, silently, which is worse than not parsing at all.
 */

export type ParsedCsv = {
  headers: string[];
  /** Every row, each keyed by header. Small files only — see `PARSE_ROW_LIMIT`. */
  rows: Record<string, string>[];
  /** The first few rows, for a preview — always populated even when `rows` is truncated. */
  sample: Record<string, string>[];
  totalRows: number;
  truncated: boolean;
};

const SAMPLE_SIZE = 5;

/**
 * Rows this build parses whole. Not a claim about what the platform can eventually import — a
 * file larger than this needs streaming and chunked staging, which nothing has asked for yet.
 * Named here so the limit is one number, not a guess repeated at every call site.
 */
export const PARSE_ROW_LIMIT = 5000;

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const headers = result.meta.fields ?? [];
  if (headers.length === 0) {
    throw new DomainError('That file has no header row GOLD could read.', 'integrations.csv_no_headers');
  }

  const totalRows = result.data.length;
  const truncated = totalRows > PARSE_ROW_LIMIT;
  const rows = truncated ? result.data.slice(0, PARSE_ROW_LIMIT) : result.data;

  return {
    headers,
    rows,
    sample: result.data.slice(0, SAMPLE_SIZE),
    totalRows,
    truncated,
  };
}
