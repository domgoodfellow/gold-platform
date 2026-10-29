import { describe, expect, it } from 'vitest';
import { dispatchHref } from '@/features/work/dispatch-url';
import { upcomingWindow, zonedDayRange, shiftDate } from '@/lib/domain/scheduling/window';

describe('Dispatch URL state', () => {
  const state = { on: '2026-10-28', type: 'service', status: 'ready', resource: 'alex', assignment: 'upcoming', page: '3', selected: 'job', mode: 'map' };
  it('clears the previous type stage, page and selection while preserving other criteria', () => {
    const p = new URL(dispatchHref('org', state, { type: 'desk' }), 'http://local').searchParams;
    expect(p.get('type')).toBe('desk');
    for (const key of ['status', 'page', 'selected']) expect(p.has(key)).toBe(false);
    expect(p.get('resource')).toBe('alex');
    expect(p.get('assignment')).toBe('upcoming');
    expect(p.get('mode')).toBe('map');
  });
  it('preserves the selection across page and presentation changes', () => {
    const p = new URL(dispatchHref('org', state, { page: '4', mode: 'list' }), 'http://local').searchParams;
    expect(p.get('selected')).toBe('job');
    expect(p.get('page')).toBe('4');
  });
  it('resets pagination and selection on date, search and assignment changes', () => {
    for (const changes of [{ on: '2026-10-29' }, { q: 'boiler' }, { assignment: '' }] as Record<string, string>[]) {
      const p = new URL(dispatchHref('org', state, changes), 'http://local').searchParams;
      expect(p.has('page')).toBe(false);
      expect(p.has('selected')).toBe(false);
    }
  });
});

describe('Dashboard and Dispatch upcoming local dates', () => {
  for (const [date, hours] of [['2026-03-06', 167], ['2026-10-30', 169], ['2026-10-20', 168]] as const) {
    it(`keeps seven dates after ${date} across DST`, () => {
      const timezone = 'America/Toronto';
      const window = upcomingWindow(date, timezone);
      expect(window.startsAt).toBe(zonedDayRange(date, timezone).endsAt);
      expect(window.endsAt).toBe(zonedDayRange(shiftDate(date, 7), timezone).endsAt);
      expect((Date.parse(window.endsAt) - Date.parse(window.startsAt)) / 3600000).toBe(hours);
    });
  }
});
