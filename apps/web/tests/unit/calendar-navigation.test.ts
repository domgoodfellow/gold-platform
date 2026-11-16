import {describe,it,expect} from 'vitest';
import {calendarWorkspace,legacyCalendarHref} from '@/lib/application/calendar/navigation';
describe('shared Calendar URLs',()=>{
 it('retains date, view, sources and repeated values when consolidating workspace routes',()=>{
  const url=new URL(legacyCalendarHref('org','field',{on:'2026-11-01',view:'week',source:'work',resource:['a','b'],scope:'workspace'}),'http://localhost');
  expect(url.pathname).toBe('/organizations/org/calendar');expect(url.searchParams.get('workspace')).toBe('field');expect(url.searchParams.get('on')).toBe('2026-11-01');expect(url.searchParams.getAll('resource')).toEqual(['a','b']);expect(url.searchParams.get('view')).toBe('week');expect(url.searchParams.get('source')).toBe('work');
 });
 it('preserves explicit business-wide intent and validates workspace provenance',()=>{
  expect(legacyCalendarHref('org','crm',{scope:'organization'})).toBe('/organizations/org/calendar');
  expect(calendarWorkspace('crm')).toBe('crm');expect(calendarWorkspace('platform')).toBeUndefined();
 });
});
