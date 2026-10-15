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
  record?: { type: string; id: string };
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
  'work_item.assigned',
  'work_item.unscheduled',
  'work_item.line_added',
  'work_item.line_removed',
  'work_item.cost_recorded',
  'work_item.time_recorded',
  'work_item.updated',
  'invoice.issued',
  'payment.recorded',
] as const;

/** Events written directly against a location — `entity_type = 'location'`, no second query needed for these two. */
const LOCATION_DIRECT_ACTIONS = ['location.created', 'location.linked'] as const;

/** Events written directly against an asset. */
const ASSET_DIRECT_ACTIONS = ['asset.created'] as const;

/**
 * The only two `work_item.*` actions that snapshot `asset_id` in their own payload
 * (`create_work_item`, `update_work_item`) — see `listAssetTimeline`'s own comment for why nothing
 * else in `WORK_ITEM_ACTIONS` qualifies and why this is not the same list `update_work_item`
 * offers `location_id` from too.
 */
const ASSET_WORK_ITEM_ACTIONS = ['work_item.created', 'work_item.updated'] as const;

/** Actions a customer's history is made of. Anything else is noise on this screen. */
const OPPORTUNITY_ACTIONS = ['opportunity.created', 'opportunity.updated', 'opportunity.stage_changed'] as const;
const FOLLOW_UP_ACTIONS = ['follow_up.created', 'follow_up.updated', 'follow_up.completed', 'follow_up.cancelled'] as const;
const SERVICE_ACTIONS = ['client_tenant.linked', 'client_tenant.ended', 'service_engagement.created', 'service_engagement.status_changed', 'service_engagement.tenant_bound', 'service_engagement.deliverable_attached', 'service_engagement.work_attached', 'service_disclosure.saved', 'service_disclosure.published', 'service_disclosure.withdrawn', 'service_review.released', 'service_review.withdrawn', 'service_review.approved', 'service_review.changes_requested'] as const;
const NOTIFICATION_ACTIONS = ['notification.intent_created', 'notification.delivery_requested', 'notification.accepted', 'notification.delivered', 'notification.bounced', 'notification.failed', 'notification.rejected', 'notification.consent_recorded', 'notification.consent_withdrawn'] as const;
const CRM_ACTIONS = ['customer.created', 'customer.updated', 'customer.stage_changed', 'customer.imported', 'customer.import_matched', ...OPPORTUNITY_ACTIONS, ...FOLLOW_UP_ACTIONS, ...SERVICE_ACTIONS, ...NOTIFICATION_ACTIONS] as const;
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
  ...OPPORTUNITY_ACTIONS,
  ...FOLLOW_UP_ACTIONS,
  ...SERVICE_ACTIONS,
  ...NOTIFICATION_ACTIONS,
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
  entity_type?: string;
};

function eventActorName(row: EventRow, names: Map<string, string>): string | null {
  if (row.actor_id === '00000000-0000-4000-8000-0000000000b1') return 'Email delivery';
  if (row.action === 'notification.consent_recorded' || row.action === 'notification.consent_withdrawn') return 'Verified notification recipient';
  return names.get(row.actor_id) ?? null;
}

/** Names this tenant currently uses, for resolving the ids an event carries. */
type Vocabulary = {
  statuses: Map<string, string>;
  resources: Map<string, string>;
  workItems: Map<string, string>;
  /** Empty for a business that has not switched reception on, which reads as "no word for it". */
  stages: Map<string, string>;
  outcomes: Map<string, string>;
  /** Only resolved by a caller that needs to name a customer from a payload id — today, a location's own timeline reading `location.linked` from the other side. */
  customers?: Map<string, string>;
};

/**
 * Who an event says is on the job. `resource_ids` since a work item could have many; `resource_id`
 * is what every event written before that carries, and it is read here for as long as those events
 * exist — history is not rewritten to match a column that no longer does.
 */
function resourceIdsOf(payload: Record<string, unknown>): string[] {
  const many = payload.resource_ids;
  if (Array.isArray(many)) return many.filter((id): id is string => typeof id === 'string');
  const one = payload.resource_id;
  return typeof one === 'string' ? [one] : [];
}

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The platform's words, not the tenant's — only the looked-up strings from `words` are
 * tenant-authored.
 *
 * `perspective` disambiguates the one action written against the *other* side of what it
 * describes: `location.linked` names the location and carries the customer in its payload
 * (I11), so "Linked to a location" reads correctly from a customer's own timeline but makes no
 * sense on the location's — there it is the customer who did the linking, and the location's
 * timeline says so instead, the same relationship named from its own side.
 */
function describe(row: EventRow, words: Vocabulary, perspective?: 'location'): string {
  const job = words.workItems.get(row.entity_id);
  const on = job ? ` on ${job}` : '';

  switch (row.action) {
    case 'notification.intent_created':
      return `Customer notification recorded: ${text(row.payload, 'state') === 'queued' ? 'queued' : text(row.payload, 'state') === 'failed' ? 'delivery unavailable' : text(row.payload, 'state') === 'suppressed' ? 'ineligible' : 'not requested'}`;
    case 'notification.delivery_requested':
      return 'Customer notification queued for email delivery';
    case 'notification.accepted':
      return 'Customer notification accepted by email provider';
    case 'notification.delivered':
      return 'Email provider reported customer notification delivered';
    case 'notification.bounced':
      return 'Customer notification bounced; recipient suppressed';
    case 'notification.failed':
      return 'Customer notification delivery failed';
    case 'notification.rejected':
      return 'Email provider rejected customer notification';
    case 'notification.consent_recorded':
      return 'Notification address verified and selected email preferences recorded';
    case 'notification.consent_withdrawn':
      return 'Customer email notification consent withdrawn';
    case 'client_tenant.linked':
      return 'Tenant relationship linked';
    case 'client_tenant.ended':
      return 'Tenant relationship ended';
    case 'service_engagement.created':
      return 'Service engagement created';
    case 'service_engagement.status_changed':
      return `Service engagement ${text(row.payload, 'to') ?? 'status changed'}`;
    case 'service_engagement.tenant_bound':
      return 'Tenant associated with a service engagement';
    case 'service_engagement.deliverable_attached':
      return 'Deliverable attached to a service engagement';
    case 'service_engagement.work_attached':
      return 'Work Item attached to a service engagement';
    case 'service_disclosure.saved':
      return 'Customer service update saved as draft';
    case 'service_disclosure.published':
      return 'Customer service update published';
    case 'service_disclosure.withdrawn':
      return 'Customer service update withdrawn';
    case 'service_review.released':
      return 'Customer review requested';
    case 'service_review.withdrawn':
      return 'Customer review withdrawn';
    case 'service_review.approved':
      return 'Customer approved service review';
    case 'service_review.changes_requested':
      return 'Customer requested changes';
    case 'follow_up.created':
    case 'follow_up.updated':
    case 'follow_up.completed':
    case 'follow_up.cancelled':
      return `Follow-up ${row.action.split('.')[1]}: ${text(row.payload, 'title') ?? 'Untitled'}`;
    case 'opportunity.created':
      return `Opportunity created: ${text(row.payload, 'title') ?? 'Untitled'}`;
    case 'opportunity.updated':
      return `Opportunity updated: ${text(row.payload, 'title') ?? 'Untitled'}`;
    case 'opportunity.stage_changed':
      return `Opportunity ${text(row.payload, 'title') ?? 'Untitled'} moved to ${text(row.payload, 'stage_name') ?? 'Unstaged'}${text(row.payload, 'stage_kind') ? ` (${text(row.payload, 'stage_kind')})` : ''}`;
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
    case 'location.linked': {
      if (perspective === 'location') {
        const customerId = text(row.payload, 'customer_id');
        const name = customerId ? (words.customers?.get(customerId) ?? null) : null;
        return name ? `Customer linked: ${name}` : 'A customer was linked here';
      }
      return 'Linked to a location';
    }
    case 'location.created':
      return 'Location created';
    case 'asset.created':
      return 'Asset created';
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
      const names = resourceIdsOf(row.payload).flatMap((id) => words.resources.get(id) ?? []);
      return `Scheduled${names.length > 0 ? ` to ${names.join(', ')}` : ''}${on}`;
    }
    case 'work_item.assigned': {
      const names = resourceIdsOf(row.payload).flatMap((id) => words.resources.get(id) ?? []);
      return names.length > 0 ? `Assigned to ${names.join(', ')}${on}` : `Taken off every resource${on}`;
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
    actorName: eventActorName(row, names),
  }));
}

/**
 * Which slice of the organization's history a workspace's Activity rail reads. A named scope over
 * the same `describe` core, never an action list a caller supplies — so a page cannot ask the
 * event log for anything the timeline has not already decided is worth a sentence.
 */
const ACTIVITY_SCOPE_ACTIONS = {
  opportunities: OPPORTUNITY_ACTIONS,
  crm: CRM_ACTIONS,
  customers: [
    'customer.created',
    'customer.updated',
    'customer.stage_changed',
    'customer.imported',
    'customer.import_matched',
  ],
  work: WORK_ITEM_ACTIONS,
} as const;

export type ActivityScope = keyof typeof ACTIVITY_SCOPE_ACTIONS;

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
  input: { organizationId: string; limit?: number; scope?: ActivityScope; opportunityId?: string; includeRecords?: boolean },
): Promise<TimelineEntry[]> {
  const limit = input.limit ?? 20;
  const actions = input.scope ? ACTIVITY_SCOPE_ACTIONS[input.scope] : ORGANIZATION_ACTIONS;

  let query = db
    .from('events')
    .select('id, action, payload, occurred_at, actor_id, entity_id, entity_type')
    .eq('organization_id', input.organizationId)
    .in('action', actions as unknown as string[]);
  if (input.opportunityId) query = query.eq('entity_type', 'opportunity').eq('entity_id', input.opportunityId);
  const { data, error } = await query
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
    ...(input.includeRecords && row.entity_type ? { record: { type: row.entity_type, id: row.entity_id } } : {}),
    occurredAt: row.occurred_at,
    action: row.action,
    description: describe(row, words),
    actorName: eventActorName(row, names),
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
    actorName: eventActorName(row, names),
  }));
}

/**
 * A place's own history, newest first: direct events, documents attached here, and the moments a
 * job was edited to name this location.
 *
 * **Why `work_item.created` is absent and `work_item.updated` is not.** `create_work_item`'s own
 * event has never copied `location_id` into its payload — only `customer_id`, `resource_id` and
 * `asset_id` ever have (`20260828000002`, the latest definition). That is a gap in what was
 * written down, not a gap in what happened, and this reader does not paper over it with a join to
 * `work_items.location_id` — a job's location is ordinary, mutable state (`updateWorkItem`), so a
 * current-state join would attribute a job's *today's* location onto the moment it was created,
 * which is exactly the falsified history I8 exists to refuse. `update_work_item`'s own event does
 * snapshot `location_id` (`20260829000001`), so a job edited to name this location is truthfully
 * this location's history from that edit forward — the same reasoning `listWorkItemTimeline`
 * already applies to attributing `document.created` by payload rather than by `entity_id`.
 *
 * **`location.linked` needs no second query.** Unlike a customer's timeline, which has to recover
 * it from the *other* side (`customer_activity.sql`), this event is already written directly
 * against the location's own id — a location's own history is the one place I11's polymorphic-
 * subject hazard never applied.
 */
export async function listLocationTimeline(
  db: Db,
  input: { organizationId: string; locationId: string; limit?: number },
): Promise<TimelineEntry[]> {
  const limit = input.limit ?? 100;

  const [ownEvents, documentEvents, workItemEvents] = await Promise.all([
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .eq('entity_type', 'location')
      .eq('entity_id', input.locationId)
      .in('action', LOCATION_DIRECT_ACTIONS as unknown as string[]),
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .eq('action', 'document.created')
      .eq('payload->>location_id', input.locationId),
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .eq('action', 'work_item.updated')
      .eq('payload->>location_id', input.locationId),
  ]);

  if (ownEvents.error) {
    throw new DomainError(ownEvents.error.message, 'timeline.location_failed');
  }
  if (documentEvents.error) {
    throw new DomainError(documentEvents.error.message, 'timeline.location_failed');
  }
  if (workItemEvents.error) {
    throw new DomainError(workItemEvents.error.message, 'timeline.location_failed');
  }

  const rows = [
    ...(ownEvents.data ?? []),
    ...(documentEvents.data ?? []),
    ...(workItemEvents.data ?? []),
  ]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit) as EventRow[];
  if (rows.length === 0) return [];

  // Bounded by what this batch actually names, not by the whole business — the same discipline
  // `listRecentActivity` documents for the same reason. Read off `rows`, already cast and
  // already trimmed to `limit`, rather than the three pre-slice result sets.
  const jobIds = [
    ...new Set(rows.filter((row) => row.action === 'work_item.updated').map((row) => row.entity_id)),
  ];
  const customerIds = [
    ...new Set(
      rows
        .filter((row) => row.action === 'location.linked')
        .map((row) => text(row.payload, 'customer_id'))
        .filter((id): id is string => id !== null),
    ),
  ];

  const [jobs, customers, members] = await Promise.all([
    jobIds.length > 0
      ? db
          .from('work_items')
          .select('id, title')
          .eq('organization_id', input.organizationId)
          .in('id', jobIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
    customerIds.length > 0
      ? db
          .from('customers')
          .select('id, name')
          .eq('organization_id', input.organizationId)
          .in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    db
      .from('memberships')
      .select('user_id, display_name')
      .eq('organization_id', input.organizationId),
  ]);

  const words: Vocabulary = {
    statuses: new Map(),
    resources: new Map(),
    workItems: new Map((jobs.data ?? []).map((row) => [row.id, row.title])),
    stages: new Map(),
    outcomes: new Map(),
    customers: new Map((customers.data ?? []).map((row) => [row.id, row.name])),
  };
  const names = new Map((members.data ?? []).map((row) => [row.user_id, row.display_name]));

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    description: describe(row, words, 'location'),
    actorName: eventActorName(row, names),
  }));
}

/**
 * What work is about, and its own history: direct events, documents attached here, and the two
 * `work_item.*` actions that actually snapshot `asset_id` in their own payload.
 *
 * **Both `work_item.created` and `work_item.updated` qualify here, unlike a location's.**
 * `create_work_item`'s event has carried `asset_id` since the column itself arrived
 * (`20260827000004`) — the asymmetry with `location_id` above is a fact about what one event
 * writer copied and the other didn't, not a difference this reader invents. No other
 * `work_item.*` action carries `asset_id` (`status_changed`, `scheduled`, `unscheduled`, a priced
 * line, a cost, an invoice, a payment — none of them do), so nothing else here would be
 * truthfully attributable without joining to the asset a job currently names, which is exactly
 * the current-state hazard this reader refuses for the same reason `listLocationTimeline` does.
 *
 * **Readings are deliberately absent.** `recordAssetReading` writes no `events` row at all — only
 * `asset_readings`, an append-only counter log read by its own dedicated section. Nothing here
 * fabricates one.
 */
export async function listAssetTimeline(
  db: Db,
  input: { organizationId: string; assetId: string; limit?: number },
): Promise<TimelineEntry[]> {
  const limit = input.limit ?? 100;

  const [ownEvents, documentEvents, workItemEvents] = await Promise.all([
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .eq('entity_type', 'asset')
      .eq('entity_id', input.assetId)
      .in('action', ASSET_DIRECT_ACTIONS as unknown as string[]),
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .eq('action', 'document.created')
      .eq('payload->>asset_id', input.assetId),
    db
      .from('events')
      .select('id, action, payload, occurred_at, actor_id, entity_id')
      .eq('organization_id', input.organizationId)
      .in('action', ASSET_WORK_ITEM_ACTIONS as unknown as string[])
      .eq('payload->>asset_id', input.assetId),
  ]);

  if (ownEvents.error) {
    throw new DomainError(ownEvents.error.message, 'timeline.asset_failed');
  }
  if (documentEvents.error) {
    throw new DomainError(documentEvents.error.message, 'timeline.asset_failed');
  }
  if (workItemEvents.error) {
    throw new DomainError(workItemEvents.error.message, 'timeline.asset_failed');
  }

  const rows = [
    ...(ownEvents.data ?? []),
    ...(documentEvents.data ?? []),
    ...(workItemEvents.data ?? []),
  ]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit) as EventRow[];
  if (rows.length === 0) return [];

  // Bounded by what this batch actually names, not by the whole business — the same discipline
  // `listRecentActivity` documents for the same reason.
  const jobIds = [
    ...new Set(
      rows
        .filter((row) => (ASSET_WORK_ITEM_ACTIONS as readonly string[]).includes(row.action))
        .map((row) => row.entity_id),
    ),
  ];

  const [jobs, members] = await Promise.all([
    jobIds.length > 0
      ? db
          .from('work_items')
          .select('id, title')
          .eq('organization_id', input.organizationId)
          .in('id', jobIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
    db
      .from('memberships')
      .select('user_id, display_name')
      .eq('organization_id', input.organizationId),
  ]);

  const words: Vocabulary = {
    statuses: new Map(),
    resources: new Map(),
    workItems: new Map((jobs.data ?? []).map((row) => [row.id, row.title])),
    stages: new Map(),
    outcomes: new Map(),
  };
  const names = new Map((members.data ?? []).map((row) => [row.user_id, row.display_name]));

  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    action: row.action,
    description: describe(row, words),
    actorName: eventActorName(row, names),
  }));
}
