import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The categories a discovery conversation might cover. Each is a plain freeform note today --
 * the only inputs that exist until intake and guided discovery are wired up (later slices) are
 * freeform strings. A typed/dependency/confidence requirements engine is a later slice's job,
 * not this one's: this shape is deliberately the smallest thing that survives being subsumed by
 * it without a rewrite.
 */
export type DiscoverySnapshotCategory =
  | 'contactChannels'
  | 'bookingIntake'
  | 'phoneHandling'
  | 'teamAccess'
  | 'websiteSurfaces'
  | 'customerSelfService'
  | 'workersResources'
  | 'locationConstraints'
  | 'quoteInvoiceModel'
  | 'postContactWorkflow'
  | 'automationGoals'
  | 'existingSoftware';

const DISCOVERY_SNAPSHOT_CATEGORIES: readonly DiscoverySnapshotCategory[] = [
  'contactChannels',
  'bookingIntake',
  'phoneHandling',
  'teamAccess',
  'websiteSurfaces',
  'customerSelfService',
  'workersResources',
  'locationConstraints',
  'quoteInvoiceModel',
  'postContactWorkflow',
  'automationGoals',
  'existingSoftware',
];

export type DiscoverySnapshotAnswers = Partial<Record<DiscoverySnapshotCategory, string>>;

export type DiscoverySnapshot = {
  id: string;
  organizationId: string;
  customerId: string;
  answers: DiscoverySnapshotAnswers;
  createdAt: string;
  createdBy: string;
};

function isDiscoverySnapshotAnswers(value: unknown): value is DiscoverySnapshotAnswers {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).every(
    ([key, entry]) =>
      DISCOVERY_SNAPSHOT_CATEGORIES.includes(key as DiscoverySnapshotCategory) &&
      typeof entry === 'string',
  );
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

  const answers = isDiscoverySnapshotAnswers(data.answers) ? data.answers : {};

  return {
    id: data.id,
    organizationId: data.organization_id,
    customerId: data.customer_id,
    answers,
    createdAt: data.created_at,
    createdBy: data.created_by,
  };
}

/**
 * Merge new answers into the customer's discovery snapshot, starting one if none exists yet.
 *
 * A patch, never a whole document: a sales rep filling in one section, or an intake form
 * supplying the handful of categories it collects, must not blank out every other category
 * someone already answered.
 */
export async function upsertDiscoverySnapshotAnswers(
  db: Db,
  input: { organizationId: string; customerId: string; patch: DiscoverySnapshotAnswers },
): Promise<DiscoverySnapshot> {
  const actor = await requireActor(db);

  const existing = await getDiscoverySnapshot(db, input);
  const merged: DiscoverySnapshotAnswers = { ...existing?.answers, ...input.patch };

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

    return {
      id: data.id,
      organizationId: data.organization_id,
      customerId: data.customer_id,
      answers: isDiscoverySnapshotAnswers(data.answers) ? data.answers : {},
      createdAt: data.created_at,
      createdBy: data.created_by,
    };
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

  return {
    id: data.id,
    organizationId: data.organization_id,
    customerId: data.customer_id,
    answers: isDiscoverySnapshotAnswers(data.answers) ? data.answers : {},
    createdAt: data.created_at,
    createdBy: data.created_by,
  };
}

/** How much of the discovery conversation has been captured, derived rather than stored. */
export function discoverySnapshotCompleteness(
  snapshot: Pick<DiscoverySnapshot, 'answers'>,
): { answered: number; total: number } {
  const answered = DISCOVERY_SNAPSHOT_CATEGORIES.filter(
    (category) => (snapshot.answers[category] ?? '').trim().length > 0,
  ).length;

  return { answered, total: DISCOVERY_SNAPSHOT_CATEGORIES.length };
}
