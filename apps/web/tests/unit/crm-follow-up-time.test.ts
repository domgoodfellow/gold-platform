import { describe,expect,it } from 'vitest';
import { dueFilter } from '@/lib/application/crm/follow-ups';
import { winRate } from '@/lib/application/crm/dashboard';
import { calendarDates, parseCalendarDate } from '@/components/calendar/calendar-period';
import { calendarHref } from '@/components/calendar/calendar-workspace';
describe('CRM business dates and conversion',()=>{
  it('uses tenant midnight, including daylight-saving day length',()=>{
    expect(dueFilter('today','America/Toronto',new Date('2026-03-08T15:00:00Z'))).toEqual({from:'2026-03-08T05:00:00.000Z',before:'2026-03-09T04:00:00.000Z'});
    expect(dueFilter('today','America/Toronto',new Date('2026-10-08T02:00:00Z'))).toEqual({from:'2026-10-07T04:00:00.000Z',before:'2026-10-08T04:00:00.000Z'});
  });
  it('uses an instant cutoff for overdue and an honest undefined conversion',()=>{
    expect(dueFilter('overdue','Asia/Tokyo',new Date('2026-10-07T23:00:00Z'))).toEqual({before:'2026-10-07T23:00:00.000Z'});
    expect(winRate(0,0)).toBeNull();expect(winRate(0,3)).toBe(0);expect(winRate(3,1)).toBe(0.75);
  });
});

describe('shared calendar periods and contextual URLs', () => {
  it('builds Monday-first weeks and six complete month rows across year boundaries', () => {
    const dates = calendarDates('month', '2027-01-15');
    expect(dates).toHaveLength(42);
    expect(dates[0]).toBe('2026-12-28');
    expect(dates[41]).toBe('2027-02-07');
    expect(calendarDates('week', '2027-01-03')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
    expect(calendarDates('day', '2027-01-03')).toEqual(['2027-01-03']);
  });
  it('rejects impossible dates and retains domain filters when changing date or view', () => {
    expect(parseCalendarDate('2026-02-30', '2026-02-28')).toBe('2026-02-28');
    expect(parseCalendarDate('2028-02-29', '2026-02-28')).toBe('2028-02-29');
    const work = new URL(calendarHref('/schedule', 'month', '2027-01-15', {resource: ['first', 'second']}), 'https://example.test');
    expect(work.searchParams.getAll('resource')).toEqual(['first', 'second']);
    expect(work.searchParams.get('view')).toBe('month');
    const crm = new URL(calendarHref('/calendar', 'day', '2027-01-15', {source: 'all', owner: 'unassigned'}), 'https://example.test');
    expect(crm.searchParams.get('owner')).toBe('unassigned');
    expect(crm.searchParams.get('on')).toBe('2027-01-15');
  });
});
