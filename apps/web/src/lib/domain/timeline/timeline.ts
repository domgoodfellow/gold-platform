import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * What happened to a customer, read back out of `events`.
 *
 * **This is the first thing that has ever read that table.** `Event` shipped in the very
 * first slice that wrote state, on the grounds that it cannot be backfilled, and thirty-odd
 * writers have been filling it since with nothing looking. So the interesting part of this
 * module is not the query — it is what reading discovered about how those payloads were
 * written.
 *
 * **The payloads are thin about vocabulary and thick about snapshots, and that split is
 * already correct.** `work_item.status_changed` carries `from_status_id` and `to_status_id`
 * and no names; `work_item.created` carries the title; a priced line carries its description
 * and amount. That looks inconsistent and is not:
 *
 *   * A **status name is the tenant's vocabulary**, and `CLAUDE.md` says vocabulary is "rows
 *     that business wrote, and is read from the database wherever it appears". Renaming a
 *     status moves no work (D6) — the job went into a row, and that row is now called
 *     something else. Snapshotting the old word onto the event would make the timeline the
 *     one screen in the platform still showing a name the business has stopped using.
 *   * An **amount or a title is a term somebody agreed to**, and I8 says those are
 *     snapshotted so that editing configuration cannot reach backwards.
 *
 * So this resolves ids against the same rows every other screen reads, and adds no columns,
 * no payload fields and no backfill. The one thing it must handle is a row that has since
 * gone: `describe` falls back rather than rendering an empty sentence.
 *
 * **What reading did find is a subject problem, not a payload one.** `location.linked` is
 * written against the *location*, with the customer id in the payload — perfectly reasonable
 * when it was written, and invisible to a reader asking "what happened to this customer",
 * because that reader filters on `entity_id`. It is fetched separately below rather than
 * quietly dropped. The general lesson is worth more than the fix: an append-only table with
 * a polymorphic subject records which entity the *writer* thought it was about, and the
 * reader that arrives two milestones later may be standing on the other side of the row.
 *
 * Deliberately concrete and deliberately named for a customer. `constraints.md` says to
 * write it "for the business in front of you, named for what it does rather than for the
 * category it might one day belong to" — a general `listTimeline` over any entity is one
 * extraction away on the day the work item screen wants one, and is a speculative
 * abstraction today.
 */

export type TimelineEntry = {
  id: string;
  occurredAt: string;
  /** The platform's own word for what happened. Never a tenant's. */
  action: string;
  /** One sentence, in this tenant's vocabulary where the event names any of it. */
  description: string;
  /**
   * What this tenant calls the person who did it, or null if they are no longer a member.
   *
   * I11 guarantees an actor id, not a name: identity is global and this repository owns no
   * users table (D19), so the only name available is the one *this organization* wrote on a
   * membership — and somebody who has left has no membership row to read it from.
   */
  actorName: string | null;
};

/** Actions a customer's history is made of. Anything else is noise on this screen. */
const CUSTOMER_ACTIONS = [
  'customer.created',
  'location.linked',
  'document.created',
  'work_item.created',
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
};

function text(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' ? value : null;
}

/**
 * One sentence for one event.
 *
 * The platform's words, not the tenant's — "Scheduled" here is what *this system* calls
 * committing a resource, and the only tenant-authored strings are the ones looked up from
 * `words`. Terminology overrides stay deferred (`constraints.md`), and when they land this
 * is a second lookup rather than an excavation, for the same reason `navigation.ts` exists.
 */
function describe(row: EventRow, words: Vocabulary): string {
  const job = words.workItems.get(row.entity_id);
  const on = job ? ` on ${job}` : '';

  switch (row.action) {
    case 'customer.created':
      return 'Added as a customer';
    case 'location.linked':
      return 'Linked to a location';
    case 'document.created':
      return `Document attached: ${text(row.payload, 'file_name') ?? 'a file'}`;
    case 'work_item.created':
      return `Work created: ${text(row.payload, 'title') ?? 'untitled'}`;
    case 'work_item.status_changed': {
      // The id, resolved to what the tenant calls that status *today*. A status that has
      // since been deleted has no word left, and saying so is better than a blank.
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
      // The number is snapshotted onto the payload because it is a term — it is what the
      // document this customer holds says on it (I8), and unlike a status name it can never
      // be renamed by a later edit.
      const number = row.payload.number;
      return `Invoiced${typeof number === 'number' ? ` (#${number})` : ''}${on}`;
    }
    case 'payment.recorded': {
      // The amount and its currency, snapshotted for the same reason. The provider is a fact
      // about where the money came from and a null one is a person writing it down.
      const amount = row.payload.amount_minor;
      const currency = text(row.payload, 'currency');
      const money =
        typeof amount === 'number' && currency ? ` ${formatMoney(amount, currency)}` : '';
      return `Payment recorded${money}${on}`;
    }
    default:
      // Unreachable while CUSTOMER_ACTIONS is the filter, and here so that adding an action
      // to that list without a sentence degrades to something legible rather than blank.
      return row.action;
  }
}

/**
 * One customer's history, newest first.
 *
 * **A customer's timeline is not only events about the customer row.** Almost everything a
 * business remembers about a customer happened to a *job* — it was booked, moved, priced,
 * done. So this reads events for the customer and for that customer's work items together,
 * which is why the work item ids are fetched first rather than joined: `events` holds
 * `(entity_type, entity_id)` with no foreign key, deliberately, and
 * `schema-conformance.test.ts` forbids that polymorphic shape anywhere else precisely so
 * this table stays the only one.
 *
 * Every read here is under RLS, and the `organization_id` filters are the usual optimisation
 * rather than the boundary.
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
  const subjects = [input.customerId, ...workItems.keys()];

  const SELECT = 'id, action, payload, occurred_at, actor_id, entity_id';

  const [subject, linked] = await Promise.all([
    db
      .from('events')
      .select(SELECT)
      .eq('organization_id', input.organizationId)
      .in('entity_id', subjects)
      .in('action', CUSTOMER_ACTIONS as unknown as string[])
      .order('occurred_at', { ascending: false })
      .limit(limit),
    // The one action this customer is the *object* of rather than the subject. Filtered on
    // the payload because that is where the writer put the customer id; see the note above
    // on why this is a fact about append-only tables rather than a mistake to correct.
    db
      .from('events')
      .select(SELECT)
      .eq('organization_id', input.organizationId)
      .eq('action', 'location.linked')
      .eq('payload->>customer_id', input.customerId)
      .order('occurred_at', { ascending: false })
      .limit(limit),
  ]);

  if (subject.error) {
    throw new DomainError(subject.error.message, 'timeline.list_failed');
  }
  if (linked.error) {
    throw new DomainError(linked.error.message, 'timeline.list_failed');
  }

  const rows = [...(subject.data ?? []), ...(linked.data ?? [])]
    .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
    .slice(0, limit) as EventRow[];
  if (rows.length === 0) return [];

  // The tenant's current words, and who its people are. Three reads rather than three joins:
  // `events` carries ids in a jsonb payload, which PostgREST cannot embed through, and the
  // alternative would be a resolution per row.
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
    workItems,
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
