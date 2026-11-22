import { describe, expect, it } from 'vitest';
import { homePeriod, homeQuery, prioritize, emptySource, type HomeAttentionItem, type HomeResult } from '@/lib/application/home/contracts';
import { assignSetupHealth, isolateSource } from '@/lib/application/home/load';
import { attentionItem, readStudioHome, type ReadContext } from '@/lib/application/home/reads';
import { calendarDate } from '@/lib/domain/scheduling/window';
import { counted } from '@/lib/domain/counted';
import { parseCallParams, callFilterFromParams } from '@/features/communications/voice/call-filters';

const make = (id: string, extra: Partial<HomeAttentionItem> = {}): HomeAttentionItem => ({ key: `Support:case:${id}`, organizationId: 'a', source: 'Support', category: 'case', title: id, description: '', kind: 'task', urgency: 'normal', overdue: false, record: { kind: 'case', id }, destination: { href: '/case', label: 'Open' }, ...extra });
describe('Home semantic projections', () => {
  it('distinguishes an exact zero from an unavailable count without serializing count metadata as rows', () => {
    expect(counted([], 0).exactCount).toBe(0);
    expect(counted(['preview'], null).exactCount).toBeNull();
    expect(JSON.stringify(counted(['preview'], 12))).toBe('["preview"]');
  });
  it('normalizes crafted filters without admitting arbitrary scopes or periods', () => {
    expect(homeQuery({ scope: 'admin', when: 'all', attention: ['overdue'] })).toEqual({ scope: 'organization', when: 'today', attention: 'all', schedule: 'today' });
    expect(homeQuery({ scope: 'mine', when: 'month', attention: 'overdue' })).toEqual({ scope: 'mine', when: 'month', attention: 'overdue', schedule: 'today' });
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
  it('groups shared setup reasons by configuration owner and deduplicates messages', () => {
    const results: HomeResult[] = ['CRM', 'Communications', 'Finance', 'Studio'].map(source => ({ source: source as HomeResult['source'], state: 'ready', data: emptySource(source as HomeResult['source']) }));
    const feature = (featureKey: string, setupHref: string, reason: string) => ({ featureKey, setupHref, reason, entitled: true, activation: 'active' as const, readiness: 'setup_required' as const });
    assignSetupHealth(results, [
      feature('customer_profile', '/organizations/a/comms/configuration/calling', 'No calling number'),
      feature('booking_intake', '/organizations/a/settings/domains', 'No public address'),
      feature('price_book', '/organizations/a/finance/configuration/pricing', 'Nothing is priced yet'),
      feature('invoices', '/organizations/a/finance/configuration/pricing', 'Nothing is priced yet'),
    ], new Set(['organization.manage']));
    const health = results.flatMap(result => result.state === 'ready' ? result.data.health : []);
    expect(health.map(item => [item.source, item.detail])).toEqual(expect.arrayContaining([
      ['Communications', 'No calling number'], ['Studio', 'No public address'], ['Finance', 'Nothing is priced yet'],
    ]));
    expect(health).toHaveLength(3);
    expect(health.some(item => item.source === 'CRM')).toBe(false);
  });
  it('does not offer setup destinations that the actor cannot configure', () => {
    const results: HomeResult[] = [{ source: 'Finance', state: 'ready', data: emptySource('Finance') }];
    assignSetupHealth(results, [{ featureKey: 'price_book', setupHref: '/organizations/a/finance/configuration/pricing', reason: 'No prices', entitled: true, activation: 'active', readiness: 'setup_required' }], new Set());
    expect(results[0].state === 'ready' && results[0].data.health).toEqual([]);
  });
  it('preserves exact Home period and actionable missed-call filters in Communications', () => {
    const { params } = parseCallParams({ from: '2026-10-01', to: '2026-11-01', followup: '1', wrap: 'needed' });
    expect(callFilterFromParams(params, 'America/Toronto')).toMatchObject({ since: '2026-10-01T04:00:00.000Z', until: '2026-11-01T04:00:00.000Z', needsFollowUp: true, needsWrapUp: false });
    expect(parseCallParams({ from: '2026-02-30', to: '2026-03-02' }).params).toEqual({});
    expect(calendarDate('2026-02-30')).toBeUndefined();
  });
});

describe('Home attention classification', () => {
  const NOW = '2026-11-21T15:00:00.000Z';
  const context = (db: unknown = {}): ReadContext => ({ db: db as ReadContext['db'], organizationId: 'org', membershipId: 'm', resourceId: null, schedulable: true, date: '2026-11-21', timezone: 'UTC', now: NOW, query: homeQuery({}), period: homePeriod('2026-11-21', 'UTC', 'today'), features: new Set(), capabilities: new Set(['organization.manage']), assistantEntitled: false });
  it('is overdue only when an explicit deadline has passed, never because the record is old', () => {
    const c = context();
    expect(attentionItem(c, 'CRM', 'follow-up', '1', 'Call', '', '/t', { overdue: true, dueAt: '2026-11-21T09:00:00.000Z' }).overdue).toBe(true);
    expect(attentionItem(c, 'CRM', 'follow-up', '2', 'Call', '', '/t', { overdue: true, dueAt: '2026-11-22T09:00:00.000Z' }).overdue).toBe(false);
    expect(attentionItem(c, 'Communications', 'conversation', '3', 'Old thread', '', '/c', { overdue: true, occurredAt: '2026-01-01T00:00:00.000Z' }).overdue).toBe(false);
    expect(attentionItem(c, 'Communications', 'conversation', '3', 'Old thread', '', '/c').kind).toBe('task');
  });
  it('leaves Studio drafts to Studio and lists only revisions awaiting publication review, with an exact count', async () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const summary = { workingTotal: 2, draftTotal: 3, working: [{ id: id(1), status: 'draft', revision_number: 5, created_at: NOW }, { id: id(2), status: 'in_review', revision_number: 4, created_at: NOW }], drafts: [{ id: id(3), form_id: id(4), name: 'Intake form', created_at: NOW }], published: [] };
    const studio = await readStudioHome(context({ rpc: async () => ({ data: summary, error: null }) }));
    expect(studio.attention.map(row => [row.title, row.kind, row.status])).toEqual([['Website revision 4', 'review', 'In review']]);
    expect(studio.attention.some(row => row.category === 'form-draft')).toBe(false);
    expect(studio.categories).toEqual([expect.objectContaining({ key: 'website-revision', label: 'Website revision awaiting review', total: 1 })]);
    // Beyond the bounded preview the number awaiting review is unknown, so no total is claimed.
    const bounded = await readStudioHome(context({ rpc: async () => ({ data: { ...summary, workingTotal: 9 }, error: null }) }));
    expect(bounded.categories).toEqual([]);
  });
});
