import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import type { AutomationRule } from '@/lib/domain/automation/rules';

/**
 * Reading a business's rules back to it, and saying which ones cannot work.
 *
 * **The failures this catches are the ones nothing else can.** `automation_runs` records a rule
 * that ran and failed; the platform console shows those. What neither can show is a rule that
 * **never fires at all** — a threshold in a unit no reading ever uses, a status nothing can move
 * into, a message rule on jobs that have no customer. Those produce no failure and no run,
 * because nothing happened. Silence looks identical to a business having nothing to do.
 *
 * **None of this is AI and none of it should be.** It is arithmetic on rows this business
 * already has, and it has a reader today. When a language model gets involved it will be for the
 * harder question — *what will this do to people* rather than *can this work at all* — and it
 * will want these answers underneath it either way.
 *
 * **Everything below is a warning and nothing is a refusal.** A rule that looks wrong here may be
 * right about a future this business is about to configure: somebody writing rules before writing
 * statuses is working in a reasonable order. Refusing would make the screen argue with them; a
 * sentence lets them decide.
 */

export type RuleWarning = {
  ruleId: string;
  message: string;
};

/**
 * Every unit that has ever actually been recorded, for the two kinds of reading a rule compares.
 *
 * **This is what catches the worst mistake this platform allows.** Units are compared and never
 * converted — deliberately, because converting has a date and a date makes this different
 * software — so a threshold typed as `kph` against readings that say `km/h` is not a rule that
 * half-works. It is a rule that is silent forever, on a screen that shows nothing wrong.
 */
async function unitsInUse(
  db: Db,
  organizationId: string,
): Promise<{ readings: Set<string>; counters: Set<string> }> {
  const [external, counters] = await Promise.all([
    db.from('external_readings').select('unit').eq('organization_id', organizationId).limit(500),
    db.from('asset_readings').select('unit').eq('organization_id', organizationId).limit(500),
  ]);

  if (external.error) {
    throw new DomainError(external.error.message, 'automations.review_failed');
  }
  if (counters.error) {
    throw new DomainError(counters.error.message, 'automations.review_failed');
  }

  return {
    readings: new Set((external.data ?? []).map((row) => row.unit)),
    counters: new Set((counters.data ?? []).map((row) => row.unit)),
  };
}

/**
 * What is wrong with this business's rules, in sentences somebody can act on.
 *
 * Takes the rules rather than reading them, because the screen has already read them and reading
 * them twice would let the two answers disagree about a rule somebody edited in between.
 */
export async function reviewAutomationRules(
  db: Db,
  input: {
    organizationId: string;
    rules: AutomationRule[];
    /** Every status this business has, with the kind of work it belongs to. */
    statuses: { id: string; typeId: string; name: string; typeName: string }[];
  },
): Promise<RuleWarning[]> {
  if (input.rules.length === 0) return [];

  const [transitions, definitions, units] = await Promise.all([
    db
      .from('work_item_transitions')
      .select('to_status_id')
      .eq('organization_id', input.organizationId),
    listFieldDefinitions(db, { organizationId: input.organizationId, entityType: 'work_item' }),
    unitsInUse(db, input.organizationId),
  ]);

  if (transitions.error) {
    throw new DomainError(transitions.error.message, 'automations.review_failed');
  }

  const reachable = new Set((transitions.data ?? []).map((row) => row.to_status_id));
  const fieldKeys = new Set(definitions.map((entry) => `custom.${entry.key}`));
  const statusById = new Map(input.statuses.map((status) => [status.id, status]));

  const warnings: RuleWarning[] = [];
  const say = (ruleId: string, message: string) => warnings.push({ ruleId, message });

  // Rules that fire on the same moment and disagree about where the job should end up. Only the
  // first one to run gets its way; the second finds the job already moved, or is refused.
  const movesByTrigger = new Map<string, { ruleId: string; statusId: string }[]>();

  for (const rule of input.rules) {
    if (!rule.enabled) continue;

    if (rule.actions.length === 0) {
      say(rule.id, 'This rule has nothing to do, so it runs and changes nothing.');
    }

    for (const action of rule.actions) {
      if (action.kind === 'change_status' && action.statusId) {
        const target = statusById.get(action.statusId);

        // **The check that catches the most common broken rule.** A status is reached by a
        // transition this business wired; with none pointing at it, no job can ever arrive
        // there and every run of this rule fails on `app.check_status_transition` (I13).
        if (!reachable.has(action.statusId)) {
          say(
            rule.id,
            target
              ? `Nothing can move into “${target.name}” — no ${target.typeName} lifecycle has a step ending there, so this will fail every time it runs.`
              : 'This moves a job to a status that is no longer here.',
          );
        }

        if (rule.triggerKind === 'event') {
          const key = String(rule.triggerEventAction);
          movesByTrigger.set(key, [
            ...(movesByTrigger.get(key) ?? []),
            { ruleId: rule.id, statusId: action.statusId },
          ]);
        }
      }

      // A message rule needs somebody to write to, and a job created at the counter has nobody.
      // The run fails with a sentence saying exactly this, but only after it has already failed
      // once — and on a busy day that is a page of failures a business has to read past.
      if (action.kind === 'notify') {
        const guarded = rule.conditions.some(
          (condition) => condition.subjectField === 'customer_id' && condition.operator === 'is_set',
        );
        if (!guarded) {
          say(
            rule.id,
            'This will fail on any job with no customer attached. Add a condition that the customer has been filled in.',
          );
        }
      }

      if (action.kind === 'create_work_item' && !action.typeId) {
        say(rule.id, 'This raises a job without saying what kind of work it is.');
      }
    }

    // A condition on a field the registry no longer has. It reads as empty rather than raising,
    // which is the right behaviour and also the reason nobody would notice: the rule quietly
    // starts matching a different set of jobs.
    for (const condition of rule.conditions) {
      if (condition.subjectField.startsWith('custom.') && !fieldKeys.has(condition.subjectField)) {
        say(
          rule.id,
          `This checks a field that no longer exists (${condition.subjectField.slice(7)}), so it reads as empty on every job.`,
        );
      }
    }

    // The two triggers that compare a number against a unit, and the silence they produce when
    // the unit does not match. Only warned about once something has actually been recorded —
    // before that there is nothing to compare against and no reason to doubt what was typed.
    if (rule.triggerKind === 'external_reading' && rule.triggerUnit) {
      if (units.readings.size > 0 && !units.readings.has(rule.triggerUnit)) {
        say(
          rule.id,
          `No reading has ever been recorded in ${rule.triggerUnit}. Readings so far are in ${[...units.readings].join(', ')}, and units are never converted — so this rule will never fire.`,
        );
      }
    }

    if (rule.triggerKind === 'counter_threshold' && rule.triggerUnit) {
      if (units.counters.size > 0 && !units.counters.has(rule.triggerUnit)) {
        say(
          rule.id,
          `No counter has ever been read in ${rule.triggerUnit}. Counters so far are in ${[...units.counters].join(', ')}, and units are never converted — so this rule will never fire.`,
        );
      }
    }

    if (rule.triggerKind === 'external_reading' && rule.actions.some((a) => a.kind === 'notify')) {
      // Weather rules act on jobs in the diary; a rule that only tells somebody, without moving
      // anything, tells them about a job that has not changed.
      if (!rule.actions.some((a) => a.kind === 'shift_schedule' || a.kind === 'change_status')) {
        say(
          rule.id,
          'This tells the customer about conditions but changes nothing about the job, so the message will describe a booking that has not moved.',
        );
      }
    }
  }

  for (const [, moves] of movesByTrigger) {
    const targets = new Set(moves.map((move) => move.statusId));
    if (moves.length > 1 && targets.size > 1) {
      for (const move of moves) {
        say(
          move.ruleId,
          'Another rule runs at the same moment and moves the job somewhere else. Whichever runs first wins, and the other is likely to fail.',
        );
      }
    }
  }

  return warnings;
}
