import { describe, expect, it } from 'vitest';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';

/**
 * An organization's day is its own, not the server's or UTC's. These pin the boundaries with
 * fixed instants, so nothing here depends on when the suite runs.
 */
describe('organization-local day boundaries', () => {
  it('starts a Toronto day at 04:00Z in summer and 05:00Z in winter', () => {
    expect(zonedDayRange('2026-10-10', 'America/Toronto').startsAt).toBe('2026-10-10T04:00:00.000Z');
    expect(zonedDayRange('2026-12-10', 'America/Toronto').startsAt).toBe('2026-12-10T05:00:00.000Z');
  });

  it('puts the instant just before local midnight on the previous local day, whatever the UTC date', () => {
    const range = zonedDayRange('2026-10-10', 'America/Toronto');
    const justBefore = new Date(Date.parse(range.startsAt) - 1);
    expect(justBefore.toISOString().slice(0, 10)).toBe('2026-10-10'); // still the 10th in UTC
    expect(todayInZone('America/Toronto', justBefore)).toBe('2026-10-09'); // but the 9th in Toronto
    expect(todayInZone('UTC', justBefore)).toBe('2026-10-10');
  });

  it('is 23 hours on the spring-forward day and 25 on the fall-back day', () => {
    const hours = (day: string) => {
      const range = zonedDayRange(day, 'America/Toronto');
      return (Date.parse(range.endsAt) - Date.parse(range.startsAt)) / 3_600_000;
    };
    // Toronto: DST began 2026-03-08 and ends 2026-11-01. endsAt may be the last instant or the next start.
    expect(Math.round(hours('2026-03-08'))).toBe(23);
    expect(Math.round(hours('2026-11-01'))).toBe(25);
    expect(Math.round(hours('2026-06-15'))).toBe(24);
  });

  it('keeps the local date across the UTC midnight that follows a Toronto evening', () => {
    expect(todayInZone('America/Toronto', new Date('2026-07-01T02:30:00Z'))).toBe('2026-06-30');
    expect(todayInZone('Asia/Tokyo', new Date('2026-07-01T02:30:00Z'))).toBe('2026-07-01');
  });
});
