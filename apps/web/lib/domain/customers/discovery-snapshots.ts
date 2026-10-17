import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import {
  DISCOVERY_REQUIREMENTS,
  discoveryRequirementsFor,
  type DiscoveryRequirementKey,
  type DiscoveryStage,
} from './discovery-requirements';

/**
 * Where an answer stands. `unknown` is absence, not a stored value — the same reasoning
 * `customers.stageId` being nullable already carries here: a requirement nobody has
 * touched yet is not a row saying so.
 *
 * `provided` is what a prospect said themselves, unconfirmed by anyone at GildOps. `confirmed`
 * is what a person here read and affirmed, whether they typed it fresh or agreed with what
 * intake already had. `not_applicable` is a person's own answer too — "this does not apply to
 * them" is information a salesperson gives during discovery, not a blank left for later.
 *
 * `inferred` is deliberately absent: the plan that names this lifecycle never says what would
 * produce an inferred *answer* (Slice 6 infers a proposed *configuration* from answers already
 * given, which is a different output), so adding the status now would be exactly the "no caller"
 * case the rest of this file avoids. Add it, with whatever first produces one, when that slice
 * arrives.
 */
export type DiscoveryAnswerStatus = 'provided' | 'confirmed' | 'not_applicable';

export type DiscoveryAnswer = {
  /** Blank for a `not_applicable` answer — there is nothing to say, only that nothing applies. */
  value: string;
  status: DiscoveryAnswerStatus;
  /** Free text naming what produced this answer — a form, a call, a person's own entry. Not a closed vocabulary: nothing downstream branches on its exact wording. */
  source: string;
  updatedAt: string;
};

export type DiscoverySnapshotAnswers = Partial<Record<DiscoveryRequirementKey, DiscoveryAnswer>>;

export type DiscoverySnapshot = {
  id: string;
  organizationId: string;
  customerId: string;
  answers: DiscoverySnapshotAnswers;
  createdAt: string;
  createdBy: string;
};

function isDiscoveryAnswer(value: unknown): value is DiscoveryAnswer {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.value === 'string' &&
    (candidate.status === 'provided' || candidate.status === 'confirmed' || candidate.status === 'not_applicable') &&
    typeof candidate.source === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function isDiscoverySnapshotAnswers(value: unknown): value is DiscoverySnapshotAnswers {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, entry]) =>
      DISCOVERY_REQUIREMENTS.some((requirement) => requirement.key === key) &&
      isDiscoveryAnswer(entry),
  );
}

function readSnapshot(data: {
  id: string;
  organization_id: string;
  customer_id: string;
  answers: unknown;
  created_at: string;
  created_by: string;
}): DiscoverySnapshot {
  return {
    id: data.id,
    organizationId: data.organization_id,
    customerId: data.customer_id,
    answers: isDiscoverySnapshotAnswers(data.answers) ? data.answers : {},
    createdAt: data.created_at,
    createdBy: data.created_by,
  };
}

/**
 * The discovery snapshot for one customer, or null.
 *
 * Null covers both "no snapshot started" and "not yours" without the caller telling them apart
 * -- RLS produces that indistinguishability for free, same as `getCustomer`.
 */
export async function getDiscoverySnapshot(
  db: Db,
  input: { organizationId: string; customerId: string },
): Promise<DiscoverySnapshot | null> {
  const { data, error } = await db
    .from('customer_discovery_snapshots')
    .select('id, organization_id, customer_id, answers, created_at, created_by')
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'discovery_snapshots.get_failed');
  }
  if (!data) return null;

  return readSnapshot(data);
}

export type DiscoveryAnswerPatch = Partial<
  Record<DiscoveryRequirementKey, { value: string; status: DiscoveryAnswerStatus; source: string }>
>;

/**
 * Merge new answers into the customer's discovery snapshot, starting one if none exists yet.
 *
 * A patch, never a whole document: a sales rep filling in one section, or an intake form
 * supplying the handful of requirements it collects, must not blank out every other requirement
 * someone already answered. `updatedAt` is this function's own, never the caller's, so a patch
 * cannot backdate an answer.
 *
 * An entry whose `value` is blank clears that requirement rather than storing an empty answer —
 * "unknown" is absence here, the same as everywhere else this domain holds that rule, so a
 * form submitting its untouched fields alongside a real edit does not manufacture eleven empty
 * "confirmed" answers nobody gave. `not_applicable` is the one status this does not apply to: a
 * blank value there is not "nothing was said", it is the answer.
 */
export async function upsertDiscoverySnapshotAnswers(
  db: Db,
  input: { organizationId: string; customerId: string; patch: DiscoveryAnswerPatch },
): Promise<DiscoverySnapshot> {
  const actor = await requireActor(db);

  const now = new Date().toISOString();
  const existing = await getDiscoverySnapshot(db, input);
  const merged: DiscoverySnapshotAnswers = { ...existing?.answers };

  for (const [key, answer] of Object.entries(input.patch)) {
    if (answer!.value.trim().length === 0 && answer!.status !== 'not_applicable') {
      delete merged[key as keyof DiscoverySnapshotAnswers];
      continue;
    }
    merged[key as keyof DiscoverySnapshotAnswers] = {
      value: answer!.value,
      status: answer!.status,
      source: answer!.source,
      updatedAt: now,
    };
  }

  if (existing) {
    const { data, error } = await db
      .from('customer_discovery_snapshots')
      .update({ answers: merged })
      .eq('organization_id', input.organizationId)
      .eq('customer_id', input.customerId)
      .select('id, organization_id, customer_id, answers, created_at, created_by')
      .single();

    if (error) {
      throw new DomainError(error.message, 'discovery_snapshots.update_failed');
    }

    return readSnapshot(data);
  }

  const { data, error } = await db
    .from('customer_discovery_snapshots')
    .insert({
      organization_id: input.organizationId,
      customer_id: input.customerId,
      answers: merged,
      created_by: actor.id,
    })
    .select('id, organization_id, customer_id, answers, created_at, created_by')
    .single();

  if (error) {
    if (error.code === '23503') {
      throw new DomainError(
        'That customer is not in this organization.',
        'discovery_snapshots.customer_not_found',
      );
    }
    throw new DomainError(error.message, 'discovery_snapshots.create_failed');
  }

  return readSnapshot(data);
}

/**
 * How much of one stage's requirements have been resolved, derived rather than stored. A
 * requirement is resolved by a real answer or by being marked `not_applicable` — both are a
 * salesperson having addressed it, which is the question completeness actually answers.
 *
 * Defaults to `sales_discovery`, the one stage a person works from this snapshot today; a caller
 * asks for a different stage explicitly (`public_intake`'s own completeness, read by nothing yet,
 * is still a real, callable question rather than a guess).
 */
export function discoverySnapshotCompleteness(
  snapshot: Pick<DiscoverySnapshot, 'answers'>,
  stage: DiscoveryStage = 'sales_discovery',
): { answered: number; total: number } {
  const requirements = discoveryRequirementsFor(stage);
  const answered = requirements.filter((requirement) => {
    const answer = snapshot.answers[requirement.key];
    return answer && (answer.status === 'not_applicable' || answer.value.trim().length > 0);
  }).length;

  return { answered, total: requirements.length };
}

/** The requirements of one stage with no answer at all yet — neither given nor marked not applicable. */
export function unresolvedDiscoveryRequirements(
  snapshot: Pick<DiscoverySnapshot, 'answers'>,
  stage: DiscoveryStage = 'sales_discovery',
): readonly { key: DiscoveryRequirementKey; question: string }[] {
  return discoveryRequirementsFor(stage)
    .filter((requirement) => !snapshot.answers[requirement.key])
    .map((requirement) => ({ key: requirement.key, question: requirement.question }));
}

/**
 * A discovery snapshot, in the business's own words, as the free-text description the drafting
 * adapter already knows how to turn into a `BusinessShape` (`proposeConfiguration`).
 *
 * Every line is a question this catalogue already asked, paired with exactly what was recorded
 * against it — never a paraphrase, never a value this function invents for a requirement nobody
 * has answered. A `not_applicable` requirement is named as such rather than skipped, so a person
 * reading this back can tell "not asked" apart from "asked and doesn't apply" the same way the
 * snapshot itself does. Unanswered requirements are left out entirely: what to say about them is
 * `unresolvedDiscoveryRequirements`'s job, not a blank line here.
 *
 * Empty when nothing has been answered — a caller decides what a blank means to it.
 */
export function describeDiscoverySnapshot(
  snapshot: Pick<DiscoverySnapshot, 'answers'>,
  stage: DiscoveryStage = 'sales_discovery',
): string {
  const lines: string[] = [];
  for (const requirement of discoveryRequirementsFor(stage)) {
    const answer = snapshot.answers[requirement.key];
    if (!answer) continue;
    const value = answer.status === 'not_applicable' ? 'Not applicable.' : answer.value;
    lines.push(`${requirement.question}\n${value}`);
  }
  return lines.join('\n\n');
}
