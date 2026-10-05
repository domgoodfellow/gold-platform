import { describe, expect, it } from 'vitest';
import { localDateTimeToInstant } from '@/lib/domain/scheduling/window';
import { exceptionInstants, validateWorkingPeriods } from '@/lib/domain/scheduling/resource-availability';

describe('validateWorkingPeriods', () => {
  it('normalises times and orders by day then start', () => {
    expect(
      validateWorkingPeriods([
        { dayOfWeek: 2, opensAt: '13:00', closesAt: '17:00' },
        { dayOfWeek: 1, opensAt: '09:00', closesAt: '12:30' },
        { dayOfWeek: 2, opensAt: '08:00', closesAt: '12:00' },
      ]),
    ).toEqual([
      { dayOfWeek: 1, opensAt: '09:00:00', closesAt: '12:30:00' },
      { dayOfWeek: 2, opensAt: '08:00:00', closesAt: '12:00:00' },
      { dayOfWeek: 2, opensAt: '13:00:00', closesAt: '17:00:00' },
    ]);
  });

  it('allows back-to-back periods as a split shift, and refuses overlap', () => {
    expect(() =>
      validateWorkingPeriods([
        { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' },
        { dayOfWeek: 1, opensAt: '12:00', closesAt: '17:00' },
      ]),
    ).not.toThrow();
    expect(() =>
      validateWorkingPeriods([
        { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' },
        { dayOfWeek: 1, opensAt: '11:00', closesAt: '17:00' },
      ]),
    ).toThrow(expect.objectContaining({ code: 'resource_hours.overlap' }));
  });

  it('refuses zero-length, reversed, invalid-day and invalid-time periods', () => {
    const bad = (period: { dayOfWeek: number; opensAt: string; closesAt: string }) =>
      () => validateWorkingPeriods([period]);
    expect(bad({ dayOfWeek: 1, opensAt: '09:00', closesAt: '09:00' })).toThrow(
      expect.objectContaining({ code: 'resource_hours.closes_before_opens' }),
    );
    expect(bad({ dayOfWeek: 1, opensAt: '17:00', closesAt: '09:00' })).toThrow(
      expect.objectContaining({ code: 'resource_hours.closes_before_opens' }),
    );
    expect(bad({ dayOfWeek: 8, opensAt: '09:00', closesAt: '10:00' })).toThrow(
      expect.objectContaining({ code: 'resource_hours.day_invalid' }),
    );
    expect(bad({ dayOfWeek: 1, opensAt: '25:00', closesAt: '26:00' })).toThrow(
      expect.objectContaining({ code: 'resource_hours.time_invalid' }),
    );
  });

  it('accepts an empty week — a resource that never works is a statement, not an error', () => {
    expect(validateWorkingPeriods([])).toEqual([]);
  });
});

describe('exceptionInstants — local entry means the organization’s zone, never the server’s', () => {
  it('reads an all-day exception as the whole local day, which is not 00:00–23:59 UTC', () => {
    // Toronto is UTC-4 in June.
    expect(
      exceptionInstants({ startDate: '2027-06-10', endDate: '2027-06-10', timeZone: 'America/Toronto' }),
    ).toEqual({ startsAt: '2027-06-10T04:00:00.000Z', endsAt: '2027-06-11T04:00:00.000Z' });
  });

  it('reads a multi-day vacation through to the end of its last local day', () => {
    expect(
      exceptionInstants({ startDate: '2027-06-01', endDate: '2027-06-05', timeZone: 'Europe/Amsterdam' }),
    ).toEqual({ startsAt: '2027-05-31T22:00:00.000Z', endsAt: '2027-06-05T22:00:00.000Z' });
  });

  it('reads a partial day as local wall-clock', () => {
    expect(
      exceptionInstants({
        startDate: '2027-06-08',
        endDate: '2027-06-08',
        startTime: '13:00',
        endTime: '15:30',
        timeZone: 'America/Toronto',
      }),
    ).toEqual({ startsAt: '2027-06-08T17:00:00.000Z', endsAt: '2027-06-08T19:30:00.000Z' });
  });

  it('keeps a 10:00 entry at 10:00 local whatever the offset, either side of a DST change', () => {
    const entry = (date: string) =>
      exceptionInstants({
        startDate: date,
        endDate: date,
        startTime: '10:00',
        endTime: '11:00',
        timeZone: 'America/Toronto',
      }).startsAt;
    expect(entry('2027-03-13')).toBe('2027-03-13T15:00:00.000Z'); // EST, UTC-5
    expect(entry('2027-03-14')).toBe('2027-03-14T14:00:00.000Z'); // EDT, UTC-4
    expect(entry('2027-11-06')).toBe('2027-11-06T14:00:00.000Z'); // EDT
    expect(entry('2027-11-07')).toBe('2027-11-07T15:00:00.000Z'); // EST
  });

  it('makes an all-day exception 23 hours on a spring-forward day and 25 on a fall-back day', () => {
    const hours = (date: string) => {
      const window = exceptionInstants({ startDate: date, endDate: date, timeZone: 'America/Toronto' });
      return (new Date(window.endsAt).getTime() - new Date(window.startsAt).getTime()) / 3_600_000;
    };
    expect(hours('2027-03-14')).toBe(23);
    expect(hours('2027-11-07')).toBe(25);
  });
});

describe('localDateTimeToInstant — the scheduling form’s datetime-local, read in the business’s zone', () => {
  it('reads 10:00 as 10:00 where the business is, not where the server is', () => {
    expect(localDateTimeToInstant('2026-10-13T10:00', 'Europe/Amsterdam')).toBe('2026-10-13T08:00:00.000Z');
    expect(localDateTimeToInstant('2026-10-13T10:00', 'America/Toronto')).toBe('2026-10-13T14:00:00.000Z');
    expect(localDateTimeToInstant('2026-10-13T10:00', 'UTC')).toBe('2026-10-13T10:00:00.000Z');
  });

  it('leaves an explicit instant, and anything it cannot read, alone', () => {
    expect(localDateTimeToInstant('2026-10-13T10:00:00.000Z', 'Europe/Amsterdam')).toBe('2026-10-13T10:00:00.000Z');
    expect(localDateTimeToInstant('2026-10-13T10:00+02:00', 'America/Toronto')).toBe('2026-10-13T10:00+02:00');
    expect(localDateTimeToInstant('', 'UTC')).toBe('');
    expect(localDateTimeToInstant('soon', 'UTC')).toBe('soon');
  });
});
