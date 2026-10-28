import { describe, expect, it } from 'vitest';
import { readableWorkWidgets, scheduledVolumeChart, workSetupStep, WORK_WIDGETS } from '@/lib/application/work/dashboard';
import { parseWorkDirectory, workDirectoryHref } from '@/features/work/work-directory';
import { layoutProblems, defaultLayout } from '@/lib/dashboard-layout';

/**
 * Work W1's pure rules: which single setup step a business is on, which Dashboard widgets have
 * something truthful to show, that the volume chart carries `workOperations`' own history, and that
 * the Work items address never keeps a status that cannot apply.
 */
const ORG = '11111111-1111-4111-8111-111111111111';
const type = (id: string, ready: boolean, schedulable: boolean) => ({ id, name: id, ready, schedulable });
const data = (types: ReturnType<typeof type>[], recorded: number, resources = 0) => ({ setup: { types, resources }, recorded });

describe('Work Dashboard setup step', () => {
  it('asks for a type, then a starting stage, then the first work item, in that order', () => {
    expect(workSetupStep(data([], 0))).toEqual({ kind: 'no-types' });
    expect(workSetupStep(data([type('Survey', false, true)], 0))).toEqual({ kind: 'no-starting-stage', typeId: 'Survey', typeName: 'Survey' });
    expect(workSetupStep(data([type('Survey', false, true), type('Paperwork', true, false)], 0))).toEqual({ kind: 'no-work', typeId: 'Paperwork' });
    expect(workSetupStep(data([type('Paperwork', true, false)], 3))).toBeNull();
  });

  it('never asks for resources: work that is never scheduled has no scheduling widgets at all', () => {
    expect([...readableWorkWidgets(data([type('Paperwork', true, false)], 3))].sort()).toEqual(['activity', 'overview']);
    expect([...readableWorkWidgets(data([type('Call', true, true)], 3, 0))].sort()).toEqual(['activity', 'attention', 'capacity', 'overview', 'today', 'upcoming', 'volume']);
    expect([...readableWorkWidgets(data([], 0))]).toEqual(['overview']);
  });

  it('uses a valid layout of the shared grid', () => {
    expect(layoutProblems(WORK_WIDGETS, defaultLayout(WORK_WIDGETS))).toEqual([]);
  });
});

describe('Scheduled work chart', () => {
  it('draws exactly the read model history, one linked day each, with no second count', () => {
    const history = [{ date: '2026-10-21', count: 3 }, { date: '2026-10-22', count: 0 }, { date: '2026-10-27', count: 1 }];
    const chart = scheduledVolumeChart(history, '2026-10-27', day => `/schedule?on=${day}`);
    expect(chart.shape).toBe('time-series');
    expect(chart.categories.map(c => [c.at, c.href])).toEqual(history.map(h => [h.date, `/schedule?on=${h.date}`]));
    expect(chart.series).toHaveLength(1);
    expect(chart.series[0].points).toEqual([{ value: 3, label: '3 jobs' }, { value: 0, label: '0 jobs' }, { value: 1, label: '1 job' }]);
    expect(chart.period).toBe('Seven days ending Oct 27');
  });
});

describe('Work items address', () => {
  const view = parseWorkDirectory({ type: 'a', status: 's1', q: 'leak', sort: 'title', page: '3' });

  it('reads only known values and defaults the rest', () => {
    expect(view).toEqual({ type: 'a', view: 'list', q: 'leak', status: 's1', sort: 'title', page: 3 });
    expect(parseWorkDirectory({ sort: 'price', view: 'grid', page: '-4' })).toEqual({ type: undefined, view: 'list', q: '', status: undefined, sort: 'newest', page: 1 });
  });

  it('drops the status when the type changes or the Board is chosen, and returns to the first page', () => {
    expect(workDirectoryHref(ORG, view, { type: 'b' })).toBe(`/organizations/${ORG}/work?type=b&q=leak&sort=title`);
    expect(workDirectoryHref(ORG, view, { view: 'board' })).toBe(`/organizations/${ORG}/work?type=a&view=board&q=leak&sort=title`);
    expect(workDirectoryHref(ORG, view, { type: 'a' })).toBe(`/organizations/${ORG}/work?type=a&q=leak&status=s1&sort=title`);
  });

  it('keeps every criterion when paging, and Reset keeps the type and presentation', () => {
    expect(workDirectoryHref(ORG, view, { page: 4 })).toBe(`/organizations/${ORG}/work?type=a&q=leak&status=s1&sort=title&page=4`);
    expect(workDirectoryHref(ORG, { ...view, view: 'board', status: undefined }, { q: '', status: undefined })).toBe(`/organizations/${ORG}/work?type=a&view=board&sort=title`);
  });
});
