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
 * `customers.stageId` being nullable already carries here (D31): a requirement nobody has
 * touched yet is not a row saying so.
 *
 * `provided` is what a prospect said themselves, unconfirmed by anyone at GildOps.
 * `confirmed` is what a person here read and affirmed, whether they typed it fresh or agreed
 * with what intake already had. `inferred` — a value nothing here produces yet — arrives with
 * whatever slice first proposes an answer nobody gave (D31, and the caller-bar this file
 * otherwise holds to: no status without something setting it).
 */
export type DiscoveryAnswerStatus = 'provided' | 'confirmed';

export type DiscoveryAnswer = {
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
    (candidate.status === 'provided' || candidate.status === 'confirmed') &&
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
 * "unknown" is absence here (D31), the same as everywhere else this domain holds that rule, so a
 * form submitting its untouched fields alongside a real edit does not manufacture eleven empty
 * "confirmed" answers nobody gave.
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
    if (answer!.value.trim().length === 0) {
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
 * How much of one stage's requirements have an answer, derived rather than stored.
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
  const answered = requirements.filter(
    (requirement) => (snapshot.answers[requirement.key]?.value ?? '').trim().length > 0,
  ).length;

  return { answered, total: requirements.length };
}
