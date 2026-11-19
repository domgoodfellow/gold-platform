import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  draftErrors,
  draftFormData,
  draftRule,
  minutesBefore,
  triggerErrors,
  type WorkflowDraft,
} from '@/features/automations/create/workflow-draft';
import { describeTrigger } from '@/lib/domain/automation/describe';
import { projectRule } from '@/lib/domain/automation/workflow-graph';

const draft = (overrides: Partial<WorkflowDraft>): WorkflowDraft => ({ ...EMPTY_DRAFT, ...overrides });
const sent = (value: WorkflowDraft) => Object.fromEntries(draftFormData('org-1', value));

describe('a new workflow draft', () => {
  it('asks for a trigger before anything else, and a name', () => {
    expect(draftErrors(EMPTY_DRAFT)).toEqual({ kind: 'Choose what sets it off.', name: 'Give the workflow a name.' });
    expect(draftErrors(draft({ name: '   ', kind: 'event', event: 'work_item.created' }))).toEqual({ name: 'Give the workflow a name.' });
    expect(draftErrors(draft({ name: 'x'.repeat(121), kind: 'event', event: 'work_item.created' })).name).toBe('Use 120 characters or fewer.');
  });

  it('checks only the chosen trigger’s own settings', () => {
    expect(triggerErrors(draft({ kind: 'event' }))).toEqual({ event: 'Choose which moment.' });
    expect(triggerErrors(draft({ kind: 'external_reading' }))).toEqual({
      metric: 'Choose what is measured.',
      comparison: 'Choose which way.',
      threshold: 'Enter a number.',
      readingUnit: 'Enter the unit the reading is taken in.',
    });
    expect(triggerErrors(draft({ kind: 'counter_threshold', counterStep: '0' }))).toEqual({
      counterStep: 'Enter a number above zero.',
      counterUnit: 'Enter the unit the machine counts in.',
    });
    // A half-finished reading trigger does not block a counter trigger.
    expect(triggerErrors(draft({ kind: 'counter_threshold', metric: 'temperature', counterStep: '250', counterUnit: 'hours' }))).toEqual({});
  });

  it('counts time before a job in whole minutes, up to fourteen days', () => {
    expect(minutesBefore(draft({ beforeAmount: '2', beforeUnit: 'hours' }))).toBe(120);
    expect(minutesBefore(draft({ beforeAmount: '14', beforeUnit: 'days' }))).toBe(20160);
    expect(triggerErrors(draft({ kind: 'schedule', beforeAmount: '15', beforeUnit: 'days' }))).toEqual({ beforeAmount: 'Use a whole number, up to 14 days.' });
    expect(triggerErrors(draft({ kind: 'schedule', beforeAmount: '1.5', beforeUnit: 'hours' }))).toEqual({ beforeAmount: 'Use a whole number, up to 14 days.' });
  });

  it('sends only the chosen trigger’s values, never ones typed under another trigger', () => {
    const switched = draft({
      name: ' Service due ',
      kind: 'counter_threshold',
      counterStep: '250',
      counterUnit: 'hours',
      // Typed earlier, under triggers that are no longer chosen.
      event: 'work_item.created',
      metric: 'temperature',
      comparison: 'above',
      threshold: '30',
      readingUnit: '°C',
    });
    expect(sent(switched)).toEqual({
      organizationId: 'org-1',
      name: 'Service due',
      triggerKind: 'counter_threshold',
      triggerCounterStep: '250',
      triggerUnit: 'hours',
    });
    expect(sent(draft({ name: 'Remind', kind: 'schedule', beforeAmount: '1', beforeUnit: 'days' }))).toEqual({
      organizationId: 'org-1',
      name: 'Remind',
      triggerKind: 'schedule',
      triggerMinutesBefore: '1440',
    });
  });

  it('previews as the same graph a saved workflow draws: one trigger, nothing else yet', () => {
    const value = draft({ name: 'Remind', kind: 'schedule', beforeAmount: '2', beforeUnit: 'hours' });
    const rule = draftRule({ ...value, kind: 'schedule' });
    expect(describeTrigger(rule)).toBe('2 hours before a job starts');
    const graph = projectRule(rule, { references: { statuses: [], templates: [], types: [], fields: [] } });
    expect(graph.nodes.map((node) => node.role)).toEqual(['trigger']);
    expect(graph.semantics).toMatchObject({ conditions: 'all', actions: 'in_order', triggerEditable: false });
  });
});
