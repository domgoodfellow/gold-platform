import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';

/**
 * What an intended action may be, and what turns one into a write. The whitelist here is the
 * authority — the other runtime only declares actions a model can name; a name this file doesn't
 * know is a refusal rather than a dispatch, so the two sides can disagree safely with no shared
 * version. Every executor calls a domain function that already exists and adds no capability —
 * the refusal for somebody who may not move a job comes from the policy on `work_items`, the same
 * as if they'd dragged it by hand.
 */

export type ActionExecutor = (
  db: Db,
  input: { organizationId: string; arguments: Record<string, unknown> },
) => Promise<void>;

/** Run twice: once by the executor before it writes, once when recording the run — so a suggestion that could never work never reaches a person as a button that will fail on press. */
export type ActionValidator = (values: Record<string, unknown>) => void;

function requiredText(
  values: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = values[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError(
      `That suggestion is missing ${label}, so it cannot be carried out.`,
      'assistant.action_incomplete',
    );
  }
  return value.trim();
}

function requiredInstant(
  values: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = requiredText(values, key, label);
  // An unparseable date is caught here because "that is not a time" is the useful sentence —
  // everything else about when a job may land (overlap, buffer) is the database's to refuse (I6).
  if (Number.isNaN(Date.parse(value))) {
    throw new DomainError(
      `That suggestion's ${label} is not a time this platform can read.`,
      'assistant.action_invalid',
    );
  }
  return value;
}

/** What a uuid looks like. Nothing else can name a row here. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A weak model sometimes names a job in words rather than by id — this is what keeps that from ever appearing as a button. */
const validateReschedule: ActionValidator = (values) => {
  const workItemId = requiredText(values, 'work_item_id', 'which job');
  if (!ID.test(workItemId)) {
    throw new DomainError(
      'That suggestion does not name a real job, so it cannot be carried out.',
      'assistant.action_unknown_job',
    );
  }

  const starts = requiredInstant(values, 'starts_at', 'start');
  const ends = requiredInstant(values, 'ends_at', 'end');
  if (Date.parse(ends) <= Date.parse(starts)) {
    throw new DomainError(
      'That suggestion ends before it starts, so it cannot be carried out.',
      'assistant.action_backwards',
    );
  }
};

/**
 * Asserts an instant rather than searching for one — not a second `freeWindows` (I5); whether
 * it lands is the exclusion constraint's call, not a check here (I6). The resource is read and
 * passed back deliberately: `scheduleWorkItem`'s `resourceId` is optional, and omitting it means
 * "nobody assigned" rather than "leave as is" — moving something in time and reassigning it are
 * two different decisions, and only one is here.
 */
const rescheduleWorkItem: ActionExecutor = async (db, input) => {
  validateReschedule(input.arguments);
  const workItemId = requiredText(input.arguments, 'work_item_id', 'which job');

  const { data: current, error } = await db
    .from('work_items')
    .select('resource_id')
    .eq('id', workItemId)
    .single();

  if (error || !current) {
    throw new DomainError('That job cannot be found.', 'assistant.action_unknown_job');
  }

  await scheduleWorkItem(db, {
    workItemId,
    resourceId: current.resource_id,
    startsAt: requiredInstant(input.arguments, 'starts_at', 'start'),
    endsAt: requiredInstant(input.arguments, 'ends_at', 'end'),
  });
};

const ACTIONS: Record<string, { validate: ActionValidator; execute: ActionExecutor }> = {
  propose_reschedule: { validate: validateReschedule, execute: rescheduleWorkItem },
};

/** Null rather than a throw, so the caller can record "this platform cannot do that" as an outcome — an unmatched name is ordinary, not an error. */
export function executorFor(name: string): ActionExecutor | null {
  return ACTIONS[name]?.execute ?? null;
}

/** Returns rather than throws — the caller is deciding what to write down, not refusing a request. */
export function reasonActionCannotRun(
  name: string,
  values: Record<string, unknown>,
): string | null {
  const action = ACTIONS[name];
  if (!action) return 'This platform cannot carry out that kind of suggestion.';

  try {
    action.validate(values);
  } catch (error) {
    return error instanceof DomainError ? error.message : 'That cannot be carried out.';
  }
  return null;
}

/** Platform vocabulary — describes what the platform would do, not what the business calls anything. The model's own sentence explains why, shown alongside this. */
export const ACTION_LABELS: Record<string, string> = {
  propose_reschedule: 'Move this job',
};
