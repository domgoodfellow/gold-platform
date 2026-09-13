import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * What happened to a customer, read back out of `events`. Payloads are thin about vocabulary
 * and thick about snapshots, deliberately: a status name is the tenant's vocabulary and is
 * resolved fresh (renaming moves no work, D6), while an amount or title is a term somebody
 * agreed to and is snapshotted (I8) so editing configuration can't reach backwards. `describe`
 * falls back rather than rendering an empty sentence when a referenced row has since gone.
 * Deliberately concrete and named for a customer, not a general `listTimeline` — that's one
 * extraction away the day the work item screen wants one.
 */

export type TimelineEntry = {
  id: string;
  occurredAt: string;
  /** The platform's own word for what happened. Never a tenant's. */
  action: string;
  /** One sentence, in this tenant's vocabulary where the event names any of it. */
  description: string;
  /** I11 guarantees an actor id, not a name — identity is global (D19), so the only name available is the one this organization wrote on a membership; somebody who's left has none. */
  actorName: string | null;
};

/**
 * Actions that happened to one job — a job's own history, and most of what a business
 * remembers about a customer besides (customer_activity.sql). Extracted rather than left
 * inline in `CUSTOMER_ACTIONS` now that a job's own page is the second caller.
 *
 * `document.created` is deliberately absent from this list rather than folded in: its event is
 * always written against the document's own id, never the job's
 * (20260827000005_documents.sql/20260917000001_a_document_event_carries_its_owner.sql), so it
 * can never satisfy an `entity_type = 'work_item'` filter no matter what this list contains.
 * `listWorkItemTimeline` below fetches it as its own second query instead, the same shape
 * `customer_activity`'s view resolves it with for a customer.
 */
const WORK_ITEM_ACTIONS = [
  'work_item.created',
  'work_item.booked',
  'work_item.status_changed',
  'work_item.scheduled',
  'work_item.unscheduled',
  'work_item.line_added',
  'work_item.line_removed',
  'work_item.cost_recorded',
  'work_item.time_recorded',
  'work_item.updated',
  'invoice.issued',
  'payment.recorded',
] as const;

/** Actions a customer's history is made of. Anything else is noise on this screen. */
const CUSTOMER_ACTIONS = [
  'customer.created',
  'customer.updated',
  'customer.stage_changed',
  'customer.imported',
  'customer.import_matched',
  'call.placed',
  'call.wrapped_up',
  'location.linked',
  'document.created',
  ...WORK_ITEM_ACTIONS,
] as const;

/**
 * The same vocabulary, for a business's own feed rather than one customer's — plus the two
 * organization-level moments neither list needed before: founding and Launch. Everything else
 * is `CUSTOMER_ACTIONS` unchanged, because what is worth showing on a customer's history is
 * worth showing on the business's own, and a second, drifting list would be the thing to avoid.
 */
const ORGANIZATION_ACTIONS = [...CUSTOMER_ACTIONS, 'organization.created', 'organization.launched'] as const;

type EventRow = {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  occurred_at: string;
  actor_id: string;
  entity_id: string;
};

/** Names this tenant currently uses, for resolving the ids an event carries. */
type Vocabulary = {
  statuses: Map<string, string>;
  resources: Map<string, string>;
  workItems: Map<string, string>;
  /** Empty for a business that has not switched reception on, which reads as "no word for it". */
  stages: Map<string, string>;
  outcomes: Map<string, string>;
};

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

/** The platform's words, not the tenant's — only the looked-up strings from `words` are tenant-authored. */
function describe(row: EventRow, words: Vocabulary): string {
  const job = words.workItems.get(row.entity_id);
  const on = job ? ` on ${job}` : '';

  switch (row.action) {
    case 'customer.created':
      return 'Added as a customer';
    case 'customer.updated':
      return 'Details corrected';
    case 'customer.stage_changed': {
      const to = text(row.payload, 'to_stage_id');
      const name = to ? words.stages.get(to) : null;
      return to
        ? `Moved to ${name ?? 'a stage that no longer exists'}`
        : 'Taken off the pipeline';
    }
    // Distinct from `customer.created` on purpose — a row a person typed and a row a file
    // produced are different facts, and the timeline says which honestly rather than implying
    // somebody sat down and entered it by hand.
    case 'customer.imported':
      return 'Imported from a connected data source';
    case 'customer.import_matched':
      return 'Updated by a connected data source';
    case 'call.placed':
      return text(row.payload, 'direction') === 'inbound' ? 'Call taken' : 'Call made';
    case 'call.wrapped_up': {
      const outcome = text(row.payload, 'outcome_id');
      const name = outcome ? words.outcomes.get(outcome) : null;
      return name ? `Call written up: ${name}` : 'Call written up';
    }
    case 'location.linked':
      return 'Linked to a location';
    case 'document.created':
      return `Document attached: ${text(row.payload, 'file_name') ?? 'a file'}`;
    case 'work_item.created':
      return `Work created: ${text(row.payload, 'title') ?? 'untitled'}`;
    case 'work_item.booked':
      // Distinct from `work_item.created` — a job booked by an outsider isn't a job an operator typed, and that's the only part a customer would recognise.
      return `Booked: ${text(row.payload, 'title') ?? 'untitled'}`;
    case 'work_item.status_changed': {
      const to = text(row.payload, 'to_status_id');
      const name = to ? words.statuses.get(to) : null;
      return `Moved to ${name ?? 'a status that no longer exists'}${on}`;
    }
    case 'work_item.scheduled': {
      const resourceId = text(row.payload, 'resource_id');
      const resource = resourceId ? words.resources.get(resourceId) : null;
      return `Scheduled${resource ? ` to ${resource}` : ''}${on}`;
    }
    case 'work_item.unscheduled':
      return `Unscheduled${on}`;
    case 'work_item.line_added':
      return `Priced: ${text(row.payload, 'description') ?? 'an item'}${on}`;
    case 'work_item.line_removed':
      return `A priced item was removed${on}`;
    case 'work_item.cost_recorded':
      return `Cost recorded${on}`;
    case 'work_item.time_recorded':
      return `Time recorded${on}`;
    case 'work_item.updated':
      return `Details corrected${on}`;
    case 'invoice.issued': {
      // The number is snapshotted — it's what the document this customer holds says on it (I8), and unlike a status name it can never be renamed later.
      const number = row.payload.number;
      return `Invoiced${typeof number === 'number' ? ` (#${number})` : ''}${on}`;
    }
    case 'organization.created':
      return 'This business was created';
    case 'organization.launched':
      return 'Launched';
    case 'payment.recorded': {
      const amount = row.payload.amount_minor;
      const currency = text(row.payload, 'currency');
      const money =
        typeof amount === 'number' && currency ? ` ${formatMoney(amount, currency)}` : '';
      return `Payment recorded${money}${on}`;
    }
    default:
      // Unreachable while CUSTOMER_ACTIONS is the filter — here so a new action added without a sentence degrades legibly rather than blank.
      return row.action;
  }
}

/**
 * One customer's history, newest first. Reads events for the customer *and* their work items
 * together, via the `customer_activity` view — `events` holds `(entity_type, entity_id)` with
 * no foreign key deliberately, and this is the one table allowed that shape
 * (schema-conformance.test.ts). The action list stays here, since which events are worth
 * showing is this screen's decision.
 */
export async function listCustomerTimeline(
  db: Db,
  input: { organizationId: string; customerId: string; limit?: number },
): Promise<TimelineEntry[]> {
  const limit = input.limit ?? 100;

  const { data: jobs, error: jobsError } = await db
    .from('work_items')
    .select('id, title')
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId);

  if (jobsError) {
    throw new DomainError(jobsError.message, 'timeline.work_items_failed');
  }

  const workItems = new Map((jobs ?? []).map((job) => [job.id, job.title]));

  const { data, error } = await db
    .from('customer_activity')
    .select('event_id, action, payload, occurred_at, actor_id, entity_id')
    .eq('organization_id', input.organizationId)
    .eq('customer_id', input.customerId)
    .in('action', CUSTOMER_ACTIONS as unknown as string[])
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new DomainError(error.message, 'timeline.list_failed');
  }

  const rows = (data ?? []).map((row) => ({ ...row, id: row.event_id })) as EventRow[];
  if (rows.length === 0) return [];

  // Three reads rather than three joins — `events` carries ids in a jsonb payload, which PostgREST can't embed through.
  const [statuses, resources, members, stages, outcomes] = await Promise.all([
    db.from('work_item_statuses').select('id, name').eq('organization_id', input.organizationId),
    db.from('resources').select('id, name').eq('organization_id', input.organizationId),
    db
      .from('memberships')
      .select('user_id, display_name')
      .eq('organization_id', input.organizationId),
    // Read unconditionally rather than behind a module check — a business that's switched reception off can still hold calls made while it was on.
    db.from('customer_stages').select('id, name').eq('organization_id', input.organizationId),
    db.from('call_outcomes').select('id, name').eq('organization_id', input.organizationId),
  ]);

  const words: Vocabulary = {
    statuses: new Map((statuses.data ?? []).map((row) => [row.id, row.name])),
    resources: new Map((resources.data ?? []).map((row) => [row.id, row.name])),
    workItems,
    stages: new Map((stages.data ?? []).map((row) => [row.id, row.name])),
    outcomes: new Map((outcomes.data ?? []).map((row) => [row.id, row.name])),
  };
  const names = new Map((members.data ?? []).map((row) => [row.user_id, row.display_name]));

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    description: describe(row, words),
    actorName: names.get(row.actor_id) ?? null,
  }));
}

/**
 * What has happened in this business, newest first — the same interpretive core as
 * `listCustomerTimeline` (`describe`, the vocabulary lookups), reused rather than copied,
 * reading `events` directly instead of the customer-scoped `customer_activity` view since this
 * is not about any one customer. Descriptive, never interpretive: nothing here judges whether an
 * event was good or bad, only says what it was.
 *
 * **Bounded by the events actually returned, not by the whole business.** Resolving which jobs a
 * row refers to only fetches the handful of work items this batch's rows actually name, rather
 * than every job the organization has ever had — `listCustomerTimeline` can afford the wider
 * fetch because one customer's jobs are naturally few; a business's are not.
 */
export async function listRecentActivity(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<TimelineEntry[]> {
  const limit = input.limit ?? 20;

  const { data, error } = await db
    .from('events')
    .select('id, action, payload, occurred_at, actor_id, entity_id')
    .eq('organization_id', input.organizationId)
    .in('action', ORGANIZATION_ACTIONS as unknown as string[])
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new DomainError(error.message, 'timeline.activity_failed');
  }

  const rows = (data ?? []) as EventRow[];
  if (rows.length === 0) return [];

  // Not every row names a work item — a customer or organization event's `entity_id` is not
  // one — so this over-asks by a few ids rather than branching on action first, and the query
  // simply matches nothing for the ones that aren't.
  const entityIds = [...new Set(rows.map((row) => row.entity_id))];

  const [statuses, resources, members, stages, outcomes, jobs] = await Promise.all([
    db.from('work_item_statuses').select('id, name').eq('organization_id', input.organizationId),
    db.from('resources').select('id, name').eq('organization_id', input.organizationId),
    db.from('memberships').select('user_id, display_name').eq('organization_id', input.organizationId),
    db.from('customer_stages').select('id, name').eq('organization_id', input.organizationId),
    db.from('call_outcomes').select('id, name').eq('organization_id', input.organizationId),
    db
      .from('work_items')
      .select('id, title')
      .eq('organization_id', input.organizationId)
      .in('id', entityIds),
  ]);

  const words: Vocabulary = {
    statuses: new Map((statuses.data ?? []).map((row) => [row.id, row.name])),
    resources: new Map((resources.data ?? []).map((row) => [row.id, row.name])),
    workItems: new Map((jobs.data ?? []).map((row) => [row.id, row.title])),
    stages: new Map((stages.data ?? []).map((row) => [row.id, row.name])),
    outcomes: new Map((outcomes.data ?? []).map((row) => [row.id, row.name])),
  };
  const names = new Map((members.data ?? []).map((row) => [row.user_id, row.display_name]));

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    description: describe(row, words),
    actorName: names.get(row.actor_id) ?? null,
  }));
}

/**
 * One job's own history, newest first — the same interpretive core as `listCustomerTimeline`
 * (`describe`, the vocabulary lookups), reused rather than copied.
 *
 * Two queries rather than a view: every `WORK_ITEM_ACTIONS` event is written with
 * `entity_type = 'work_item'` and `entity_id` equal to this job's own id, so a direct filter is
 * the whole answer for those. A `document.created` event is never written that way — it is
 * always against the document's own id — so it is fetched separately, filtered on the
 * `work_item_id` its payload now carries (20260917000001), the same resolution
 * `customer_activity`'s view does in SQL for a customer.
 */
export async function listWorkItemTimeline(
  db: Db,
  input: { organizationId: string; workItemId: string; limit?: number },
): Promise<TimelineEntry[]> {
  const limit = input.limit ?? 100;

  const [ownEvents, documentEvents] = await Promise.all([
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .eq('entity_type', 'work_item')
      .eq('entity_id', input.workItemId)
      .in('action', WORK_ITEM_ACTIONS as unknown as string[]),
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .eq('action', 'document.created')
      .eq('payload->>work_item_id', input.workItemId),
  ]);

  if (ownEvents.error) {
    throw new DomainError(ownEvents.error.message, 'timeline.work_item_failed');
  }
  if (documentEvents.error) {
    throw new DomainError(documentEvents.error.message, 'timeline.work_item_failed');
  }

  const rows = [...(ownEvents.data ?? []), ...(documentEvents.data ?? [])]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit) as EventRow[];
  if (rows.length === 0) return [];

  const [statuses, resources, members] = await Promise.all([
    db.from('work_item_statuses').select('id, name').eq('organization_id', input.organizationId),
    db.from('resources').select('id, name').eq('organization_id', input.organizationId),
    db
      .from('memberships')
      .select('user_id, display_name')
      .eq('organization_id', input.organizationId),
  ]);

  const words: Vocabulary = {
    statuses: new Map((statuses.data ?? []).map((row) => [row.id, row.name])),
    resources: new Map((resources.data ?? []).map((row) => [row.id, row.name])),
    // Every row here already is this job, so `describe`'s " on <title>" would be a redundant
    // echo on the job's own page — an empty map is what makes it fall back to the bare sentence.
    workItems: new Map(),
    stages: new Map(),
    outcomes: new Map(),
  };
  const names = new Map((members.data ?? []).map((row) => [row.user_id, row.display_name]));

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    description: describe(row, words),
    actorName: names.get(row.actor_id) ?? null,
  }));
}
