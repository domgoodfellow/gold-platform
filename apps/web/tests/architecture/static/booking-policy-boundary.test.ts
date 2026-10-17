import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Booking policy is a layer of its own, around feasibility and never inside it: whether a
 * customer may book an interval is one question, whether the resources can do it is another, and a
 * staff member scheduling work is asked only the second.
 */

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry) ? [relative(ROOT, join(ROOT, path)).split(sep).join('/')] : [];
  });
}

const callers = [...sources('lib'), ...sources('app'), ...sources('features')];

describe('policy is not feasibility', () => {
  it('the feasibility engine imports nothing of booking policy', () => {
    for (const file of sources('lib/domain/scheduling')) {
      expect(read(file), file).not.toMatch(/domain\/booking/);
    }
  });

  it('the policy module reads no clock and names no resource', () => {
    const policy = read('lib/domain/booking/policy.ts');
    // `now` is always an argument, so a test can say what time it is.
    expect(policy).not.toMatch(/Date\.now\(\)/);
    expect(policy.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/new Date\(\)/);
    expect(policy).not.toMatch(/resource_id|resourceId/);
  });

  it('exactly one evaluator and one effective-policy reader exist', () => {
    const defining = (name: string) => callers.filter((file) => new RegExp(`export (async )?function ${name}\\b`).test(read(file)));
    expect(defining('evaluateBookingPolicy')).toEqual(['lib/domain/booking/policy.ts']);
    expect(defining('getEffectiveBookingPolicy')).toEqual(['lib/domain/booking/policy.ts']);
    expect(defining('evaluateCustomerChange')).toEqual(['lib/domain/booking/policy.ts']);
  });

  it('nothing outside the domain reads a policy column or calls a customer-change door', () => {
    const columns = /booking_(minimum_notice_minutes|horizon_days|cadence_minutes|allow_same_day|reschedule_cutoff_minutes|cancel_cutoff_minutes|cancellation_status_id)/;
    const doors = /customer_(cancel|reschedule)_booking|booking_change_options|booking_own_commitments/;
    const readers = callers.filter((file) => file !== 'lib/db/database.types.ts' && columns.test(read(file)));
    expect(readers.sort()).toEqual(['lib/domain/booking/policy.ts', 'lib/domain/work-items/types.ts']);
    const callingDoors = callers.filter((file) => file !== 'lib/db/database.types.ts' && doors.test(read(file)));
    expect(callingDoors.sort()).toEqual(['lib/domain/booking/changes.ts', 'lib/domain/scheduling/feasibility.ts']);
  });

  it('a screen never decides what a customer may do: it asks the database’s answer', () => {
    for (const file of callers.filter((path) => path.startsWith('app/(public)/book') || path.startsWith('features/'))) {
      expect(read(file), file).not.toMatch(/cutoff(minutes)?\s*[<>]=?\s*[\w(]|minimumNoticeMinutes\s*[*+<>]\s*[\w(]/i);
    }
  });
});
