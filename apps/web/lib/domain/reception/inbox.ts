import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { createContact, listContacts } from '@/lib/domain/contacts/contacts';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getConversation, listMessages, type Conversation, type ConversationChannel, type Message } from './messaging';
import { listEmailThread, type EmailThreadMessage } from '@/lib/domain/email/messages';

/**
 * The Communications Inbox: the human operating view over every asynchronous conversation, whatever
 * channel it runs on.
 *
 * **It unifies the task, not the channels.** A row is a conversation — who it is with, what was last
 * said, whether it is unread, who is handling it, what state it is in — read from the one canonical
 * `conversations` table. An SMS stays an SMS (its thread, its delivery states, its sender number) and an
 * email stays an email (its subject, threading, attachments, sanitized HTML); only what a person needs
 * to *operate* them is shared. No provider identifier reaches a row.
 *
 * **Three facts, three owners.** Status, the person responsible and the customer it is about are
 * properties of the conversation, changed only through database functions that check the caller and
 * write the event. Assigning a conversation does not touch the customer's CRM record, and linking one
 * never creates or edits a customer.
 */

export type ConversationStatus = 'open' | 'waiting' | 'closed';

/** Which conversations to list. One value per axis; all optional. */
export type InboxFilter = {
  search?: string;
  since?: string;
  until?: string;
  channel?: ConversationChannel | 'web';
  /** Narrow by who has to look at it. */
  view?: 'unread' | 'mine' | 'unassigned';
  /** `active` (the default) is open and waiting — everything not closed. */
  status?: ConversationStatus | 'active' | 'any';
};

export type InboxItem = {
  id: string;
  channel: ConversationChannel | 'web';
  source?: 'message' | 'website';
  sourceStatus?: string;
  /** Who it is with, in words: the customer's name, or the address/number when nobody is linked. */
  title: string;
  /** The external address or number — always shown, so an unknown sender stays understandable. */
  externalAddress: string;
  subject: string | null;
  preview: string;
  lastActivityAt: string;
  unread: boolean | null;
  status: ConversationStatus;
  assignee: { membershipId: string; name: string } | null;
  customer: { id: string; name: string } | null;
};

export type InboxPage = { items: InboxItem[]; nextCursor: string | null; total?: number };

export const INBOX_PAGE_SIZE = 30;

const INBOX_COLUMNS =
  'id, channel, external_number, external_email, subject, last_message_at, last_message_preview, unread, status, customer_id, assignee_membership_id, ' +
  'customer:contacts!conversations_organization_id_customer_id_fkey(name), assignee:memberships!conversations_assignee_fk(display_name)';

type InboxRow = {
  id: string;
  channel: string;
  external_number: string | null;
  external_email: string | null;
  subject: string | null;
  last_message_at: string;
  last_message_preview: string;
  unread: boolean;
  status: string;
  customer_id: string | null;
  assignee_membership_id: string | null;
  customer: { name: string } | null;
  assignee: { display_name: string } | null;
};

function toItem(row: InboxRow): InboxItem {
  const externalAddress = row.channel === 'email' ? (row.external_email ?? '') : (row.external_number ?? '');
  return {
    id: row.id,
    channel: row.channel as ConversationChannel,
    title: row.customer?.name ?? externalAddress,
    externalAddress,
    subject: row.subject,
    preview: row.last_message_preview,
    lastActivityAt: row.last_message_at,
    unread: row.unread,
    status: row.status as ConversationStatus,
    assignee: row.assignee_membership_id ? { membershipId: row.assignee_membership_id, name: row.assignee?.display_name ?? 'Someone' } : null,
    customer: row.customer_id ? { id: row.customer_id, name: row.customer?.name ?? 'Contact' } : null,
  };
}

/** The cursor is the last row's position in the (activity, id) order, so a page boundary can never skip or repeat a row. */
function encodeCursor(row: { lastActivityAt: string; id: string }): string {
  return `${row.lastActivityAt}|${row.id}`;
}

function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = cursor.split('|');
  if (!at || !id) throw new DomainError('That page of conversations is not valid.', 'inbox.cursor_invalid');
  return { at, id };
}

/** The signed-in person's membership in this organization — what "assigned to me" means. */
export async function currentMembershipId(db: Db, input: { organizationId: string }): Promise<string | null> {
  const actor = await requireActor(db);
  const { data, error } = await db
    .from('memberships')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('user_id', actor.id)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'inbox.membership_failed');
  return data?.id ?? null;
}

/**
 * One page of conversations, most recently active first. Filtering happens in the database, on the
 * indexes made for it; nothing is downloaded and narrowed in the browser. Another business's
 * conversations are not in the result for any filter, because RLS and the organization filter both say so.
 */
export async function listInbox(
  db: Db,
  input: { organizationId: string; filter?: InboxFilter; membershipId?: string | null; cursor?: string | null; limit?: number },
): Promise<InboxPage> {
  const filter = input.filter ?? {};
  const limit = Math.min(Math.max(input.limit ?? INBOX_PAGE_SIZE, 1), 100);

  let query = db.from('conversations').select(INBOX_COLUMNS, { count: 'exact' }).eq('organization_id', input.organizationId);
  const search = filter.search?.replace(/[^\p{L}\p{N} @+._-]/gu, '').slice(0, 100).trim();
  if (search) query = query.or(`external_number.ilike.%${search}%,external_email.ilike.%${search}%,subject.ilike.%${search}%,last_message_preview.ilike.%${search}%`);
  if (filter.since) query = query.gte('last_message_at', filter.since);
  if (filter.until) query = query.lt('last_message_at', filter.until);

  if (filter.channel) query = query.eq('channel', filter.channel);
  if (filter.view === 'unread') query = query.eq('unread', true);
  if (filter.view === 'unassigned') query = query.is('assignee_membership_id', null);
  if (filter.view === 'mine') {
    // Someone with no membership here has nothing assigned to them: an impossible id matches nothing.
    query = query.eq('assignee_membership_id', input.membershipId ?? '00000000-0000-0000-0000-000000000000');
  }

  const status = filter.status ?? 'active';
  if (status === 'active') query = query.neq('status', 'closed');
  else if (status !== 'any') query = query.eq('status', status);

  if (input.cursor) {
    const { at, id } = decodeCursor(input.cursor);
    query = query.or(`last_message_at.lt."${at}",and(last_message_at.eq."${at}",id.lt.${id})`);
  }

  const { data, error, count } = await query
    .order('last_message_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (error) throw fromDatabaseError(error, 'inbox.list_failed');

  const rows = (data ?? []) as unknown as InboxRow[];
  const page = rows.slice(0, limit).map(toItem);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? encodeCursor(last) : null, total: count ?? undefined };
}

export type InboxCounts = { unread: number; open: number; waiting: number; unassigned: number; mine: number };

/** The numbers Communications Home and the Inbox tabs show. Closed conversations are never counted as work. */
export async function getInboxCounts(db: Db, input: { organizationId: string; membershipId?: string | null }): Promise<InboxCounts> {
  const base = () => db.from('conversations').select('id', { count: 'exact', head: true }).eq('organization_id', input.organizationId);
  const [unread, open, waiting, unassigned, mine] = await Promise.all([
    base().eq('unread', true).neq('status', 'closed'),
    base().eq('status', 'open'),
    base().eq('status', 'waiting'),
    base().is('assignee_membership_id', null).neq('status', 'closed'),
    input.membershipId ? base().eq('assignee_membership_id', input.membershipId).neq('status', 'closed') : Promise.resolve({ count: 0, error: null }),
  ]);
  for (const result of [unread, open, waiting, unassigned, mine]) {
    if (result.error) throw fromDatabaseError(result.error, 'inbox.counts_failed');
  }
  return { unread: unread.count ?? 0, open: open.count ?? 0, waiting: waiting.count ?? 0, unassigned: unassigned.count ?? 0, mine: mine.count ?? 0 };
}

// --- Conversation detail -------------------------------------------------------------------------

export type CustomerCandidate = { id: string; name: string; email: string | null; phone: string | null };

/**
 * What is known about who a conversation is with. `resolved` carries the linked customer. Otherwise
 * `unresolved` (nobody holds the contact point), `suggested` (exactly one customer does — offered, not
 * assumed) or `ambiguous` (several do, and none is guessed).
 */
export type CustomerResolution =
  | { state: 'resolved'; customer: { id: string; name: string; email: string | null; phone: string | null } }
  | { state: 'unresolved' }
  | { state: 'suggested'; candidates: CustomerCandidate[] }
  | { state: 'ambiguous'; candidates: CustomerCandidate[] };

export type ActivityItem = { id: string; at: string; text: string };

export type ConversationTimeline =
  | { channel: 'sms'; messages: Message[] }
  | { channel: 'email'; messages: EmailThreadMessage[] };

export type ConversationDetail = {
  conversation: Conversation;
  status: ConversationStatus;
  statusChangedAt: string;
  assignee: { membershipId: string; name: string } | null;
  resolution: CustomerResolution;
  timeline: ConversationTimeline;
  activity: ActivityItem[];
};

/** The words for what happened to a conversation, from the events the doors wrote. */
function describeActivity(action: string, payload: Record<string, unknown>, names: Map<string, string>): string | null {
  const person = (id: unknown) => (typeof id === 'string' ? (names.get(id) ?? 'someone') : 'someone');
  switch (action) {
    case 'conversation.assigned':
      return payload.claimed ? `${person(payload.assignee_membership_id)} took this conversation` : `Assigned to ${person(payload.assignee_membership_id)}`;
    case 'conversation.reassigned':
      return `Reassigned from ${person(payload.previous_membership_id)} to ${person(payload.assignee_membership_id)}`;
    case 'conversation.released':
      return `Released by ${person(payload.previous_membership_id)}`;
    case 'conversation.opened':
      return payload.automatic ? 'Reopened — they replied' : 'Marked open';
    case 'conversation.waiting':
      return payload.automatic ? 'Waiting on them — you replied' : 'Marked waiting';
    case 'conversation.closed':
      return 'Closed';
    case 'conversation.customer_linked':
      return `Linked to ${typeof payload.customer_id === 'string' ? (names.get(payload.customer_id) ?? 'a customer') : 'a customer'}`;
    case 'conversation.customer_unlinked':
      return 'Unlinked from its customer';
    default:
      return null;
  }
}

export async function getConversationDetail(db: Db, input: { organizationId: string; conversationId: string }): Promise<ConversationDetail | null> {
  const conversation = await getConversation(db, { organizationId: input.organizationId, conversationId: input.conversationId });
  if (!conversation) return null;

  const { data: row, error } = await db
    .from('conversations')
    .select('status, status_changed_at, customer_id, assignee_membership_id')
    .eq('organization_id', input.organizationId)
    .eq('id', input.conversationId)
    .single();
  if (error) throw fromDatabaseError(error, 'inbox.detail_failed');

  const [timeline, events, assigneeRow, customerRow, candidates] = await Promise.all([
    conversation.channel === 'sms'
      ? listMessages(db, { organizationId: input.organizationId, conversationId: conversation.id }).then((messages): ConversationTimeline => ({ channel: 'sms', messages }))
      : listEmailThread(db, { organizationId: input.organizationId, conversationId: conversation.id }).then((messages): ConversationTimeline => ({ channel: 'email', messages })),
    db.from('events').select('id, action, payload, occurred_at').eq('organization_id', input.organizationId).eq('entity_type', 'conversation').eq('entity_id', conversation.id).order('occurred_at'),
    row.assignee_membership_id
      ? db.from('memberships').select('id, display_name').eq('organization_id', input.organizationId).eq('id', row.assignee_membership_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.customer_id
      ? db.from('contacts').select('id, name, email, phone').eq('organization_id', input.organizationId).eq('id', row.customer_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    row.customer_id
      ? Promise.resolve({ data: [] as { customer_id: string; name: string; email: string | null; phone: string | null }[], error: null })
      : db.rpc('conversation_customer_candidates', { p_organization_id: input.organizationId, p_conversation_id: conversation.id }),
  ]);
  for (const result of [events, assigneeRow, customerRow, candidates]) {
    if (result.error) throw fromDatabaseError(result.error, 'inbox.detail_failed');
  }

  // Names for the people and customers an event mentions: read from where they live, never copied onto the event.
  const memberIds = new Set<string>();
  const customerIds = new Set<string>();
  for (const event of events.data ?? []) {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    for (const key of ['assignee_membership_id', 'previous_membership_id']) if (typeof payload[key] === 'string') memberIds.add(payload[key] as string);
    if (typeof payload.customer_id === 'string') customerIds.add(payload.customer_id);
  }
  const names = new Map<string, string>();
  if (memberIds.size > 0) {
    const { data } = await db.from('memberships').select('id, display_name').eq('organization_id', input.organizationId).in('id', [...memberIds]);
    for (const member of data ?? []) names.set(member.id, member.display_name);
  }
  if (customerIds.size > 0) {
    const { data } = await db.from('contacts').select('id, name').eq('organization_id', input.organizationId).in('id', [...customerIds]);
    for (const customer of data ?? []) names.set(customer.id, customer.name);
  }

  const activity = (events.data ?? []).flatMap((event): ActivityItem[] => {
    const text = describeActivity(event.action, (event.payload ?? {}) as Record<string, unknown>, names);
    return text ? [{ id: event.id, at: event.occurred_at, text }] : [];
  });

  const found = candidates.data ?? [];
  const resolution: CustomerResolution = customerRow.data
    ? { state: 'resolved', customer: customerRow.data }
    : found.length === 0
      ? { state: 'unresolved' }
      : found.length === 1
        ? { state: 'suggested', candidates: found.map((c) => ({ id: c.customer_id, name: c.name, email: c.email, phone: c.phone })) }
        : { state: 'ambiguous', candidates: found.map((c) => ({ id: c.customer_id, name: c.name, email: c.email, phone: c.phone })) };

  return {
    conversation,
    status: row.status as ConversationStatus,
    statusChangedAt: row.status_changed_at,
    assignee: assigneeRow.data ? { membershipId: assigneeRow.data.id, name: assigneeRow.data.display_name } : null,
    resolution,
    timeline,
    activity,
  };
}

// --- Changing a conversation ---------------------------------------------------------------------

function refusal(error: { code?: string; message: string }): DomainError {
  if (error.code === '42501') return new DomainError('Your role cannot do that, or that is not this business’s.', 'conversation.forbidden');
  if (error.code === '22023') return fromDatabaseError(error, 'conversation.invalid');
  return fromDatabaseError(error, 'conversation.write_failed');
}

export async function setConversationStatus(db: Db, input: { organizationId: string; conversationId: string; status: ConversationStatus }): Promise<void> {
  const { error } = await db.rpc('set_conversation_status', { p_organization_id: input.organizationId, p_conversation_id: input.conversationId, p_status: input.status });
  if (error) throw refusal(error);
}

/** Take an unassigned conversation. `false` means somebody else got there first — never two owners. */
export async function claimConversation(db: Db, input: { organizationId: string; conversationId: string }): Promise<boolean> {
  const { data, error } = await db.rpc('claim_conversation', { p_organization_id: input.organizationId, p_conversation_id: input.conversationId });
  if (error) throw refusal(error);
  return data === true;
}

export async function assignConversation(db: Db, input: { organizationId: string; conversationId: string; membershipId: string }): Promise<void> {
  const { error } = await db.rpc('assign_conversation', { p_organization_id: input.organizationId, p_conversation_id: input.conversationId, p_membership_id: input.membershipId });
  if (error) throw refusal(error);
}

export async function releaseConversation(db: Db, input: { organizationId: string; conversationId: string }): Promise<void> {
  const { error } = await db.rpc('release_conversation', { p_organization_id: input.organizationId, p_conversation_id: input.conversationId });
  if (error) throw refusal(error);
}

/** Associate a conversation with a customer of this business, or with nobody (`customerId: null`). Creates and edits no customer. */
export async function linkConversationCustomer(
  db: Db,
  input: { organizationId: string; conversationId: string; customerId: string | null },
): Promise<void> {
  const { error } = await db.rpc('link_conversation_customer', {
    p_organization_id: input.organizationId,
    p_conversation_id: input.conversationId,
    // `supabase gen types` types every function argument as non-null; this one accepts null to unlink.
    p_customer_id: input.customerId as string,
  });
  if (error) throw refusal(error);
}

/**
 * The one explicit act that creates a customer from a conversation: a person chose to, named them, and
 * CRM's own `createContact` does the creating (its validation, its duplicate rule). The conversation's
 * contact point seeds the new record; nothing about it is ever copied back onto the conversation.
 */
export async function createCustomerFromConversation(
  db: Db,
  input: { organizationId: string; conversationId: string; name: string },
): Promise<string> {
  const conversation = await getConversation(db, { organizationId: input.organizationId, conversationId: input.conversationId });
  if (!conversation) throw new DomainError('No such conversation here.', 'conversation.forbidden');

  const customerId = await createContact(db, {
    organizationId: input.organizationId,
    name: input.name,
    email: conversation.channel === 'email' ? conversation.externalEmail : undefined,
    phone: conversation.channel === 'sms' ? conversation.externalNumber : undefined,
  });
  await linkConversationCustomer(db, { organizationId: input.organizationId, conversationId: input.conversationId, customerId });
  return customerId;
}

/** Customers matching a search, for the "link to an existing customer" picker. Scoped to this business by RLS and the filter. */
export async function searchCustomersToLink(db: Db, input: { organizationId: string; search: string }): Promise<CustomerCandidate[]> {
  const found = await listContacts(db, { organizationId: input.organizationId, search: input.search, limit: 8 });
  return found.map((customer) => ({ id: customer.id, name: customer.name, email: customer.email, phone: customer.phone }));
}

/** The people a conversation may be given to: members of this business whose role can handle conversations. A convenience; the database decides again. */
export async function listAssignableMembers(db: Db, input: { organizationId: string }): Promise<{ membershipId: string; name: string }[]> {
  const [members, roles] = await Promise.all([
    db.from('memberships').select('id, display_name, role_id').eq('organization_id', input.organizationId).order('display_name'),
    db.from('roles').select('id, capabilities').eq('organization_id', input.organizationId),
  ]);
  if (members.error) throw fromDatabaseError(members.error, 'inbox.members_failed');
  if (roles.error) throw fromDatabaseError(roles.error, 'inbox.members_failed');
  const able = new Set((roles.data ?? []).filter((role) => (role.capabilities ?? []).includes('message.send')).map((role) => role.id));
  return (members.data ?? []).filter((member) => able.has(member.role_id)).map((member) => ({ membershipId: member.id, name: member.display_name }));
}
