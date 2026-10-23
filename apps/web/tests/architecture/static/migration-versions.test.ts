import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Migration versions follow Supabase's `YYYYMMDDHHMMSS` UTC timestamp, as `supabase migration new`
 * writes it (docs/data.md, "Migration version numbers"). Applied files are never renamed, so the
 * versions below that are not valid timestamps stay as named historical exceptions. Any other
 * file, including every new one, must be a real time that is not in the future.
 */
const MIGRATIONS = fileURLToPath(new URL('../../../../../supabase/migrations', import.meta.url));

/** Renumbered on 2026-10-22 with a seconds value of 60–99. Applied locally and hosted; never extend. */
const HISTORICAL_EXCEPTIONS = new Set(
  Array.from({ length: 40 }, (_, index) => `202610220000${60 + index}`),
);

const files = readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort();
const versionOf = (name: string) => name.slice(0, name.indexOf('_'));

function timestamp(version: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(version);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // Date.UTC rolls an impossible part over (second 60 becomes the next minute); a round trip catches it.
  const same = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
  return same ? date : null;
}

describe('migration version numbers', () => {
  it('names every file <version>_<purpose>.sql with a unique, increasing version', () => {
    for (const name of files) expect(name, name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    const versions = files.map(versionOf);
    expect(new Set(versions).size).toBe(versions.length);
  });

  it('uses a valid UTC timestamp for every version except the recorded historical exceptions', () => {
    const invalid = files.map(versionOf).filter((version) => !HISTORICAL_EXCEPTIONS.has(version) && !timestamp(version));
    expect(invalid).toEqual([]);
  });

  it('never dates a migration in the future', () => {
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000; // allows for any developer's time zone
    const future = files.map(versionOf).filter((version) => (timestamp(version)?.getTime() ?? 0) > tomorrow);
    expect(future).toEqual([]);
  });

  it('keeps the exception list exact: every exception exists and none is a valid timestamp', () => {
    const versions = new Set(files.map(versionOf));
    for (const version of HISTORICAL_EXCEPTIONS) {
      expect(versions.has(version), version).toBe(true);
      expect(timestamp(version), version).toBeNull();
    }
  });

  it('rejects the forms the contract forbids', () => {
    expect(timestamp('20261022000060')).toBeNull(); // a counter past 59 seconds
    expect(timestamp('20261302000001')).toBeNull(); // month 13
    expect(timestamp('20261023010139')).not.toBeNull(); // what `supabase migration new` writes
  });
});
