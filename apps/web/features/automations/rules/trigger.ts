import { COMPARISONS, METRICS, TRIGGER_EVENTS, type AutomationRule } from '@/lib/domain/automation/rules';

/**
 * Minutes, in the words somebody would use.
 *
 * Stored as one number because a duration is one number; read back as hours or days because
 * "two hours" is what a business said and "120 minutes" is what the column holds.
 */
export function describeMinutes(minutes: number): string {
  if (minutes % 1440 === 0 && minutes >= 1440) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes % 60 === 0 && minutes >= 60) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} minutes`;
}

/**
 * A rule's trigger, as a sentence — the one place this is written, read by the Rules list and
 * the rule detail page alike (both used to carry their own copy inside `AutomationRuleCard`).
 *
 * Four kinds and four sentences, because they are genuinely different things and one phrasing
 * that covered all of them would describe none of them well. The trigger is never editable after
 * creation (the column grant refuses it), so this is read-only wherever it appears.
 */
export function describeTrigger(rule: AutomationRule): string {
  if (rule.triggerKind === 'schedule') {
    return `${describeMinutes(-(rule.triggerOffsetMinutes ?? 0))} before a job starts`;
  }

  if (rule.triggerKind === 'counter_threshold') {
    // The number and the unit are the business's own, printed as typed. A rule counting hours
    // and one counting kilometres are different rules and nothing converts between them.
    return `Every ${rule.triggerCounterStep} ${rule.triggerUnit} on a machine`;
  }

  if (rule.triggerKind === 'external_reading') {
    const metric = METRICS.find((entry) => entry.metric === rule.triggerMetric)?.label ?? rule.triggerMetric;
    const comparison =
      COMPARISONS.find((entry) => entry.comparison === rule.triggerComparison)?.label ??
      rule.triggerComparison;
    // The number and the unit are the business's own, printed as typed. Nothing converts.
    return `When ${metric} at the job ${comparison} ${rule.triggerThreshold} ${rule.triggerUnit}`;
  }

  const event = TRIGGER_EVENTS.find((entry) => entry.action === rule.triggerEventAction);
  return `When ${event?.label ?? rule.triggerEventAction}`;
}
