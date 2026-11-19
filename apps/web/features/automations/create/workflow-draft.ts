import {
  COMPARISONS,
  METRICS,
  TRIGGER_EVENTS,
  TRIGGER_KINDS,
  type AutomationRule,
  type TriggerKind,
} from '@/lib/domain/automation/rules';

/**
 * A workflow that does not exist yet.
 *
 * It lives only in the page's memory until it is created: choosing or switching a trigger writes
 * nothing, so an abandoned draft leaves no rule behind. Each trigger kind keeps its own values, so
 * switching back restores what was typed, and only the chosen kind's values are ever sent. The
 * domain operation (`createAutomationRule`) checks everything again; these checks only say what is
 * missing before a round trip.
 */
export type WorkflowDraft = {
  name: string;
  kind: TriggerKind | '';
  event: string;
  beforeAmount: string;
  beforeUnit: BeforeUnit;
  metric: string;
  comparison: string;
  threshold: string;
  readingUnit: string;
  counterStep: string;
  counterUnit: string;
};

export type DraftField = Exclude<keyof WorkflowDraft, 'beforeUnit'>;
export type DraftErrors = Partial<Record<DraftField, string>>;

export const BEFORE_UNITS = [
  { unit: 'minutes', label: 'Minutes', minutes: 1 },
  { unit: 'hours', label: 'Hours', minutes: 60 },
  { unit: 'days', label: 'Days', minutes: 1440 },
] as const;
export type BeforeUnit = (typeof BEFORE_UNITS)[number]['unit'];

/** The longest a reminder can run ahead of a job: fourteen days, as the domain allows. */
const MOST_MINUTES_BEFORE = 20160;
const NAME_MAX = 120;

export const EMPTY_DRAFT: WorkflowDraft = {
  name: '',
  kind: '',
  event: '',
  beforeAmount: '2',
  beforeUnit: 'hours',
  metric: '',
  comparison: '',
  threshold: '',
  readingUnit: '',
  counterStep: '',
  counterUnit: '',
};

export function isTriggerKind(value: unknown): value is TriggerKind {
  return TRIGGER_KINDS.some((entry) => entry.kind === value);
}

const number = (value: string) => (value.trim() === '' ? Number.NaN : Number(value));

/** Minutes before the job starts, or NaN when the amount is not a whole number. */
export function minutesBefore(draft: WorkflowDraft): number {
  const amount = number(draft.beforeAmount);
  const per = BEFORE_UNITS.find((entry) => entry.unit === draft.beforeUnit)?.minutes ?? 1;
  return Number.isInteger(amount) ? amount * per : Number.NaN;
}

/** What the chosen trigger still needs. Fields of other trigger kinds are never checked. */
export function triggerErrors(draft: WorkflowDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.kind) {
    errors.kind = 'Choose what sets it off.';
    return errors;
  }
  if (draft.kind === 'event' && !TRIGGER_EVENTS.some((entry) => entry.action === draft.event)) {
    errors.event = 'Choose which moment.';
  }
  if (draft.kind === 'schedule') {
    const minutes = minutesBefore(draft);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MOST_MINUTES_BEFORE) {
      errors.beforeAmount = 'Use a whole number, up to 14 days.';
    }
  }
  if (draft.kind === 'external_reading') {
    if (!METRICS.some((entry) => entry.metric === draft.metric)) errors.metric = 'Choose what is measured.';
    if (!COMPARISONS.some((entry) => entry.comparison === draft.comparison)) errors.comparison = 'Choose which way.';
    if (!Number.isFinite(number(draft.threshold))) errors.threshold = 'Enter a number.';
    if (!draft.readingUnit.trim()) errors.readingUnit = 'Enter the unit the reading is taken in.';
  }
  if (draft.kind === 'counter_threshold') {
    const step = number(draft.counterStep);
    if (!Number.isFinite(step) || step <= 0) errors.counterStep = 'Enter a number above zero.';
    if (!draft.counterUnit.trim()) errors.counterUnit = 'Enter the unit the machine counts in.';
  }
  return errors;
}

export function nameErrors(draft: WorkflowDraft): DraftErrors {
  const name = draft.name.trim();
  if (!name) return { name: 'Give the workflow a name.' };
  if (name.length > NAME_MAX) return { name: `Use ${NAME_MAX} characters or fewer.` };
  return {};
}

export function draftErrors(draft: WorkflowDraft): DraftErrors {
  return { ...triggerErrors(draft), ...nameErrors(draft) };
}

/**
 * The submission, in the fields `createRuleAction` reads. Only the chosen trigger's values are
 * included, so a value typed under another trigger kind can never be sent with this one.
 */
export function draftFormData(organizationId: string, draft: WorkflowDraft): FormData {
  const data = new FormData();
  data.set('organizationId', organizationId);
  data.set('name', draft.name.trim());
  data.set('triggerKind', draft.kind);
  if (draft.kind === 'event') data.set('triggerEventAction', draft.event);
  if (draft.kind === 'schedule') data.set('triggerMinutesBefore', String(minutesBefore(draft)));
  if (draft.kind === 'external_reading') {
    data.set('triggerMetric', draft.metric);
    data.set('triggerComparison', draft.comparison);
    data.set('triggerThreshold', draft.threshold.trim());
    data.set('triggerUnit', draft.readingUnit.trim());
  }
  if (draft.kind === 'counter_threshold') {
    data.set('triggerCounterStep', draft.counterStep.trim());
    data.set('triggerUnit', draft.counterUnit.trim());
  }
  return data;
}

/**
 * The draft as the rule it would become, for the structure preview only: the same projection the
 * workbench draws, with no conditions and no actions yet. Never stored and never submitted.
 */
export function draftRule(draft: WorkflowDraft & { kind: TriggerKind }): AutomationRule {
  const minutes = minutesBefore(draft);
  return {
    id: 'draft',
    name: draft.name.trim(),
    triggerKind: draft.kind,
    triggerEventAction: draft.kind === 'event' ? draft.event : null,
    triggerOffsetMinutes: draft.kind === 'schedule' && Number.isFinite(minutes) ? -minutes : null,
    triggerMetric: draft.kind === 'external_reading' ? draft.metric : null,
    triggerComparison: draft.kind === 'external_reading' ? draft.comparison : null,
    triggerThreshold: draft.kind === 'external_reading' ? number(draft.threshold) : null,
    triggerUnit:
      draft.kind === 'external_reading' ? draft.readingUnit.trim() : draft.kind === 'counter_threshold' ? draft.counterUnit.trim() : null,
    triggerCounterStep: draft.kind === 'counter_threshold' ? number(draft.counterStep) : null,
    enabled: false,
    conditions: [],
    actions: [],
    createdAt: '',
  };
}
