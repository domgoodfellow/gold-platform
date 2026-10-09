import { describe, expect, it } from 'vitest';
import { homePeriod, homeQuery, prioritize, emptySource, type HomeAttentionItem } from '@/lib/application/home/contracts';
import { isolateSource } from '@/lib/application/home/load';
import { calendarDate } from '@/lib/domain/scheduling/window';
import { counted } from '@/lib/domain/counted';
import { parseCallParams, callFilterFromParams } from '@/features/communications/voice/call-filters';

const make = (id: string, extra: Partial<HomeAttentionItem> = {}): HomeAttentionItem => ({ key: `Support:case:${id}`, organizationId: 'a', source: 'Support', category: 'case', title: id, description: '', urgency: 'normal', overdue: false, record: { kind: 'case', id }, destination: { href: '/case', label: 'Open' }, ...extra });
describe('Home semantic projections', () => {
  it('distinguishes an exact zero from an unavailable count without serializing count metadata as rows', () => {
    expect(counted([], 0).exactCount).toBe(0);
    expect(counted(['preview'], null).exactCount).toBeNull();
    expect(JSON.stringify(counted(['preview'], 12))).toBe('["preview"]');
  });
  it('normalizes crafted filters without admitting arbitrary scopes or periods', () => {
    expect(homeQuery({ scope: 'admin', when: 'all', attention: ['overdue'] })).toEqual({ scope: 'organization', when: 'today', attention: 'all' });
    expect(homeQuery({ scope: 'mine', when: 'month', attention: 'overdue' })).toEqual({ scope: 'mine', when: 'month', attention: 'overdue' });
  });
  it('uses organization-local DST boundaries and exclusive calendar-month ends', () => {
    expect(homePeriod('2026-03-08', 'America/Toronto', 'today')).toMatchObject({ since: '2026-03-08T05:00:00.000Z', until: '2026-03-09T04:00:00.000Z' });
    expect(homePeriod('2026-11-01', 'America/Toronto', 'today')).toMatchObject({ since: '2026-11-01T04:00:00.000Z', until: '2026-11-02T05:00:00.000Z' });
    expect(homePeriod('2026-10-09', 'America/Toronto', 'month')).toMatchObject({ from: '2026-10-01', to: '2026-11-01', since: '2026-10-01T04:00:00.000Z' });
    expect(homePeriod('2026-01-03', 'Pacific/Auckland', 'week').from).toBe('2025-12-28');
  });
  it('sorts by explicit overdue and urgency evidence with deterministic ties', () => {
    const rows = [make('normal'), make('high', { urgency: 'high' }), make('overdue', { overdue: true, urgency: 'high' }), make('critical', { overdue: true, urgency: 'critical' })];
    expect(prioritize(rows, '2026-10-10T04:00:00Z').map(r => r.title)).toEqual(['critical', 'overdue', 'high', 'normal']);
    expect(prioritize([...rows].reverse(), '2026-10-10T04:00:00Z')).toEqual(prioritize(rows, '2026-10-10T04:00:00Z'));
  });
  it('deduplicates canonical identity without merging similar titles across domains', () => {
    const a = make('x'), b = { ...a, key: 'CRM:follow-up:x', source: 'CRM' as const };
    expect(prioritize([a, b, a], '')).toHaveLength(2);
    expect(prioritize([a, { ...a, urgency: 'critical' }, a], '')[0].urgency).toBe('critical');
  });
  it('isolates source errors without replacing failures with zero metrics', async () => {
    expect(await isolateSource('Finance', async () => { throw new Error('unavailable'); })).toEqual({ source: 'Finance', state: 'unavailable' });
    expect(await isolateSource('CRM', async () => emptySource('CRM'))).toMatchObject({ state: 'ready', data: { metrics: [], attention: [] } });
  });
  it('preserves exact Home period and actionable missed-call filters in Communications', () => {
    const { params } = parseCallParams({ from: '2026-10-01', to: '2026-11-01', followup: '1', wrap: 'needed' });
    expect(callFilterFromParams(params, 'America/Toronto')).toMatchObject({ since: '2026-10-01T04:00:00.000Z', until: '2026-11-01T04:00:00.000Z', needsFollowUp: true, needsWrapUp: false });
    expect(parseCallParams({ from: '2026-02-30', to: '2026-03-02' }).params).toEqual({});
    expect(calendarDate('2026-02-30')).toBeUndefined();
  });
});
