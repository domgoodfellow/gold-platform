import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';

/**
 * What an intended action may be, and what turns one into a write.
 *
 * **The whitelist is here, and it is the authority.** The other runtime declares actions so a
 * model has a way to say what it would do; nothing over there can perform one, and a name it
 * produces that this file does not know is a refusal rather than a dispatch. That is what lets
 * the two sides disagree safely — no shared list, no version between them, and the failure mode
 * is a person being told *this platform cannot do that* rather than something unexpected being
 * written.
 *
 * **Every executor calls a domain function that already exists, and adds no capability.** The
 * refusal for somebody who may not move a job comes from the policy on `work_items`, exactly as
 * it would if they had dragged it on the schedule — which is D32's argument about applying a
 * configuration proposal, one level down. Nothing here checks a capability, because a second
 * copy of an authorization rule is the copy that goes stale.
 *
 * **One entry, and it grows one per slice with a screen behind it.** A mapping over the domain
 * layer would be the abstraction with no caller this repository refuses everywhere.
 *
 * **Validation is here rather than in a schema shared with the other runtime.** What arrives is
 * whatever a model produced: possibly the right shape, possibly a date it invented, possibly
 * nothing. Each executor below narrows it and says plainly what was wrong, and anything it lets
 * through still meets the domain function's own checks and then the database's.
 */

export type ActionExecutor = (
  db: Db,
  input: { organizationId: string; arguments: Record<string, unknown> },
) => Promise<void>;

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
  // A model writes dates well and not always. An unparseable one is caught here because the
  // message *that is not a time* is the useful sentence; everything else about when a job may
  // land — the overlap, the buffer — is the database's to refuse (I6).
  if (Number.isNaN(Date.parse(value))) {
    throw new DomainError(
      `That suggestion's ${label} is not a time this platform can read.`,
      'assistant.action_invalid',
    );
  }
  return value;
}

/**
 * Move one job.
 *
 * **The first action, and D30's reasoning is why.** It asserts an instant rather than searching
 * for one, so nothing here is a second `freeWindows` (I5), and whether it lands is decided by the
 * exclusion constraint rather than by a check that would race identically (I6). A refusal is
 * recorded on the run and read by the person who suggested pressing the button.
 */
const rescheduleWorkItem: ActionExecutor = async (db, input) => {
  const workItemId = requiredText(input.arguments, 'work_item_id', 'which job');

  // **The resource is read and passed back, and leaving it out was a bug the tests caught.**
  // `scheduleWorkItem`'s `resourceId` is optional and omitting it means *nobody assigned* rather
  // than *leave it as it is* — so the first version of this quietly took the person off the job
  // it was moving. Moving something in time is not reassigning it, and this action deliberately
  // cannot reassign: the model is given no way to name a resource, because *move this to
  // tomorrow* and *give this to somebody else* are two decisions and only one of them is here.
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

const EXECUTORS: Record<string, ActionExecutor> = {
  propose_reschedule: rescheduleWorkItem,
};

/**
 * The executor for a name, or null.
 *
 * Null rather than a throw, so the caller can record *this platform cannot do that* as an
 * outcome on the run. A name nothing matches is an ordinary thing for a model to produce and is
 * not an error in this system.
 */
export function executorFor(name: string): ActionExecutor | null {
  return EXECUTORS[name] ?? null;
}

/**
 * What to call this on screen.
 *
 * Platform vocabulary, because it describes what the platform would do rather than what the
 * business calls anything. The model's own sentence is what explains *why*, and it is shown
 * beside this rather than replaced by it.
 */
export const ACTION_LABELS: Record<string, string> = {
  propose_reschedule: 'Move this job',
};
