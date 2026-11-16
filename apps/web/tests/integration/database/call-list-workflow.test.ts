import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { archiveContact, createContact } from '@/lib/domain/contacts/contacts';
import { createRole, listRoles, updateRoleCapabilities } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import { changeTaskStatus, createTask, listTasks, removeFromCallList as cancelCallTask } from '@/lib/domain/tasks/tasks';
import { addToCallList } from '@/lib/application/communications/call-list';
import { callListQuery, loadCallList, nextCallListEntry } from '@/lib/application/communications/dialer-queue';
import {
  CALL_LIST_VIEWS, callListCounts, listCallListEntries, reassignCallTask, rescheduleCallTask, scheduleCallback, type CallListView,
} from '@/lib/domain/tasks/call-list';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The call list as a working list, against real PostgreSQL with real row security: what each view
 * holds and counts, across more calls than one page; the business's own timezone; callbacks as a
 * recorded fact; skipping, rescheduling and reassigning without a second task; who may ring which
 * number; and that none of it crosses into another business.
 *
 * Nothing here rings a telephone: `open_call` is asked directly, which is where the destination
 * rule lives, before any carrier is involved.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);

type Person = { email: string; db: SupabaseClient; membershipId?: string };
async function account(): Promise<Person> {
  const email = `call-workflow-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db };
}
const as = (person: Person) => person.db as never;
const tag = randomUUID().slice(0, 8);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A distinct, valid number for the nth contact of a group. */
const number = (group: number, index: number) => `+1416${String(5000000 + group * 1000 + index)}`;

let pg: Client;
let owner: Person, outsider: Person, caller: Person, tasker: Person, viewer: Person, bystander: Person, dialer: Person;
let organizationId: string, otherOrg: string;
let dialerRole: string;

async function member(capabilities: Capability[], name: string): Promise<Person & { roleId: string }> {
  const person = await account();
  const roleId = await createRole(as(owner), { organizationId, name: `${name} ${randomUUID().slice(0, 6)}`, capabilities });
  await addMember(as(owner), { organizationId, email: person.email, roleId });
  return { ...person, roleId, membershipId: (await currentMembershipId(as(person), { organizationId }))! };
}

/** Contacts with phone numbers, each put on the call list with one reason and due time. */
async function listed(names: string[], group: number, input: { reason: string; dueAt: string; ownerMembershipId?: string }): Promise<string[]> {
  const ids = await Promise.all(names.map((name, index) => createContact(as(owner), { organizationId, name: `${name} ${tag}`, phone: number(group, index) })));
  const result = await addToCallList(as(owner), { organizationId, target: { customerIds: ids }, ...input });
  expect(result.added).toBe(ids.length);
  return ids;
}
const openCalls = async (customerId: string) => listTasks(as(owner), { organizationId, customerId, status: 'open', kind: 'call' });
const taskOf = async (customerId: string) => (await openCalls(customerId))[0];
const view = (person: Person, input: { view?: CallListView; search?: string; exclude?: string[]; limit?: number; offset?: number } = {}) =>
  listCallListEntries(as(person), { organizationId, limit: 100, ...input });
const counts = (person: Person, input: { search?: string; exclude?: string[] } = {}) => callListCounts(as(person), { organizationId, ...input });
/** Opens a call as this person; the database answers with the call or the refusal. */
const open = (person: Person, toNumber: string, customerId: string | null = null, organization = organizationId) =>
  person.db.rpc('open_call', { p_organization_id: organization, p_customer_id: customerId as string, p_conference_name: `gold-${randomUUID()}`, p_from_number: '+14165550000', p_to_number: toNumber });

beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  [owner, outsider] = await Promise.all([account(), account()]);
  // A currency nothing prices, so opening a call never waits on credit.
  organizationId = await foundBusiness({ ownerEmail: owner.email, name: `Call workflow ${tag}`, currency: 'XXX', timezone: 'America/Toronto' });
  otherOrg = await foundBusiness({ ownerEmail: outsider.email, name: `Other workflow ${tag}`, currency: 'XXX' });
  owner.membershipId = (await currentMembershipId(as(owner), { organizationId }))!;
  const [a, b, c, d, e] = await Promise.all([
    // Works the call list: places calls, and nothing else.
    member(['call.place'], 'List caller'),
    member(['customer.read', 'follow_up.manage', 'call.place'], 'Task caller'),
    member(['customer.read'], 'Viewer'),
    member(['document.create'], 'Bystander'),
    member(['call.place', 'call.dial_manual'], 'Manual dialer'),
  ]);
  [caller, tasker, viewer, bystander, dialer] = [a, b, c, d, e];
  dialerRole = e.roleId;
}, 120_000);

afterAll(async () => { await pg.end(); });

describe('views, counts and pages across more than one page of calls', () => {
  const now = Date.now();
  let overdue: string[], dueToday: string[], upcoming: string[], mine: string[];

  beforeAll(async () => {
    // 30 calls: more than the 25 a page holds.
    const names = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${String(index).padStart(2, '0')}`);
    [overdue, upcoming, mine] = await Promise.all([
      listed(names('Overdue', 12), 1, { reason: 'Renewal reminder', dueAt: new Date(now - 3 * DAY).toISOString() }),
      listed(names('Upcoming', 12), 2, { reason: 'Spring offer', dueAt: new Date(now + 2 * DAY).toISOString() }),
      listed(names('Mine', 4), 3, { reason: 'Quote follow-through', dueAt: new Date(now + 3 * DAY).toISOString(), ownerMembershipId: tasker.membershipId }),
    ]);
    // Due a moment ago: due now, and (run at any time but the first minute of a Toronto day) not overdue.
    dueToday = await listed(names('Today', 2), 4, { reason: 'Confirm delivery', dueAt: new Date(now - 30_000).toISOString() });
  }, 120_000);

  it('pages every call earliest due first, with no call repeated or lost between pages', async () => {
    const first = await view(owner, { limit: 25 });
    const second = await view(owner, { limit: 25, offset: 25 });
    expect(first).toHaveLength(25);
    expect(second).toHaveLength(5);
    const ids = [...first, ...second].map(entry => entry.task.id);
    expect(new Set(ids).size).toBe(30);
    const due = [...first, ...second].map(entry => Date.parse(entry.task.dueAt));
    expect(due).toEqual([...due].sort((a, b) => a - b));
    expect((await counts(owner)).all).toBe(30);
    // The application read gives the page, the counts and the chosen view's own total together.
    const page = await loadCallList(as(owner), organizationId, callListQuery({ view: 'all' }));
    expect([page.items.length, page.total, page.counts.all]).toEqual([25, 30, 30]);
  });

  it('counts each view exactly as that view lists it, with and without a search', async () => {
    for (const search of [undefined, 'Overdue', tag, 'Spring offer', 'nobody-matches-this']) {
      const total = await counts(owner, { search });
      for (const name of CALL_LIST_VIEWS) {
        expect((await view(owner, { view: name, search })).length, `${name} / ${search}`).toBe(total[name]);
      }
    }
    expect(await counts(owner)).toEqual({ all: 30, mine: 0, due: 14, overdue: 12, upcoming: 16, callbacks: 0 });
  });

  it('separates due now, overdue and upcoming by the due time and the business’s day', async () => {
    const [dueNow, late, later] = await Promise.all([view(owner, { view: 'due' }), view(owner, { view: 'overdue' }), view(owner, { view: 'upcoming' })]);
    expect(new Set(late.map(entry => entry.customer.id))).toEqual(new Set(overdue));
    // Due now is everything that can be called now: today's and the overdue ones.
    expect(new Set(dueNow.map(entry => entry.customer.id))).toEqual(new Set([...overdue, ...dueToday]));
    expect(new Set(later.map(entry => entry.customer.id))).toEqual(new Set([...upcoming, ...mine]));
    expect(dueNow.find(entry => entry.customer.id === dueToday[0])!.standing).toMatchObject({ due: true, overdue: false });
    expect(late[0].standing).toMatchObject({ due: true, overdue: true });
    expect(later[0].standing).toMatchObject({ due: false, overdue: false });
  });

  it('shows every member the assigned and the unassigned calls, and each member their own under My calls', async () => {
    // Assignment is not visibility: a member who works the list sees calls owned by others and by nobody.
    for (const person of [owner, tasker, caller, viewer]) expect((await counts(person)).all).toBe(30);
    const taskers = await view(tasker, { view: 'mine' });
    expect(new Set(taskers.map(entry => entry.customer.id))).toEqual(new Set(mine));
    expect(taskers.every(entry => entry.standing.mine && entry.task.ownerMembershipId === tasker.membershipId && entry.task.ownerName)).toBe(true);
    expect((await counts(tasker)).mine).toBe(4);
    // The same calls are not the owner's, nor the list caller's.
    expect((await counts(owner)).mine).toBe(0);
    expect(await view(caller, { view: 'mine' })).toEqual([]);
    const unassigned = (await view(caller)).filter(entry => entry.task.ownerMembershipId === null);
    expect(unassigned).toHaveLength(26);
  });

  it('searches the whole list by contact name, phone number, business and reason, and treats wildcards as text', async () => {
    expect((await view(owner, { search: 'overdue07' })).map(entry => entry.customer.name)).toEqual([`Overdue07 ${tag}`]);
    // Beyond the first page of 25: found because the server searches, not the browser.
    expect((await view(owner, { search: 'Mine03' })).map(entry => entry.customer.id)).toEqual([mine[3]]);
    expect((await view(owner, { search: '(416) 500-2005' })).map(entry => entry.customer.id)).toEqual([upcoming[5]]);
    expect((await view(owner, { search: '4165002' })).length).toBe(12);
    expect((await view(owner, { search: 'quote follow' })).length).toBe(4);
    expect(await view(owner, { search: '%' })).toEqual([]);
    expect(await view(owner, { search: 'Overdue_7' })).toEqual([]);
    // A search narrows a view; it does not replace it.
    expect((await view(owner, { view: 'overdue', search: 'Upcoming' }))).toEqual([]);

    const company = await createContact(as(owner), { organizationId, name: `Northwind Supply ${tag}`, phone: number(5, 0), contactType: 'company' });
    const person = await createContact(as(owner), { organizationId, name: `Zed Okafor ${tag}`, phone: number(5, 1), contactType: 'person', companyId: company, affiliationTitle: 'Purchasing lead' });
    await addToCallList(as(owner), { organizationId, target: { customerIds: [person] }, reason: 'Trade account', dueAt: new Date(now + 5 * DAY).toISOString() });
    const [byBusiness] = await view(owner, { search: `northwind supply ${tag}` });
    expect(byBusiness.customer).toMatchObject({ id: person, companyId: company, companyName: `Northwind Supply ${tag}`, title: 'Purchasing lead', contactType: 'person' });
    expect((await view(owner, { search: 'purchasing lead' })).map(entry => entry.customer.id)).toContain(person);
    await cancelCallTask(as(owner), { organizationId, taskId: (await taskOf(person)).id });
  });

  it('leaves skipped calls out of the rows and of every count, and changes no task', async () => {
    const skipped = (await view(owner, { view: 'overdue' })).slice(0, 3).map(entry => entry.task.id);
    const rows = await view(owner, { exclude: skipped });
    expect(rows).toHaveLength(27);
    expect(rows.some(entry => skipped.includes(entry.task.id))).toBe(false);
    expect(await counts(owner, { exclude: skipped })).toEqual({ all: 27, mine: 0, due: 11, overdue: 9, upcoming: 16, callbacks: 0 });
    // Skipping is a session's own note: the tasks are open, unchanged, and back when nothing is skipped.
    const still = await listTasks(as(owner), { organizationId, status: 'open', kind: 'call', limit: 100 });
    expect(skipped.every(id => still.some(task => task.id === id))).toBe(true);
    expect((await counts(owner)).all).toBe(30);
    // Ids that are not ids, or another business's, exclude nothing and break nothing.
    expect((await view(owner, { exclude: ['not-a-task', randomUUID()] })).length).toBe(30);
  });

  it('chooses the next call from the current view, never a skipped, called or unreachable one', async () => {
    const query = callListQuery({ view: 'overdue' });
    const order = (await view(owner, { view: 'overdue' })).map(entry => entry.task.id);
    expect((await nextCallListEntry(as(caller), organizationId, query, []))!.task.id).toBe(order[0]);
    expect((await nextCallListEntry(as(caller), organizationId, { ...query, skipped: [order[0]] }, [order[1]]))!.task.id).toBe(order[2]);
    expect(await nextCallListEntry(as(caller), organizationId, { ...query, skipped: order }, [])).toBeNull();
    // My calls for a member who owns none: nobody is next, rather than someone else's call.
    expect(await nextCallListEntry(as(caller), organizationId, callListQuery({ view: 'mine' }), [])).toBeNull();
    // Calls due at the same moment are taken in a fixed order, the same one the list shows.
    expect((await nextCallListEntry(as(tasker), organizationId, callListQuery({ view: 'mine' }), []))!.task.id).toBe((await view(tasker, { view: 'mine' }))[0].task.id);

    // A contact with no phone number is never who is next, though they stay on the list.
    const silent = await createContact(as(owner), { organizationId, name: `Silent ${tag}`, phone: number(6, 0) });
    await addToCallList(as(owner), { organizationId, target: { customerIds: [silent] }, reason: 'First of all', dueAt: new Date(now - 30 * DAY).toISOString() });
    await pg.query('update public.contacts set phone = null where id = $1', [silent]);
    expect((await view(owner, { view: 'overdue' }))[0].customer).toMatchObject({ id: silent, phone: null });
    expect((await nextCallListEntry(as(caller), organizationId, query, []))!.task.id).toBe(order[0]);
    await cancelCallTask(as(owner), { organizationId, taskId: (await taskOf(silent)).id });
  });

  it('never offers a call someone else has since completed, removed or moved out of the view', async () => {
    const query = callListQuery({ view: 'overdue' });
    const [first, second, third, fourth] = (await view(owner, { view: 'overdue' })).map(entry => entry.task.id);
    // Another operator completes the first, removes the second and reschedules the third to next week.
    await changeTaskStatus(as(tasker), { organizationId, id: first, status: 'completed' });
    await cancelCallTask(as(owner), { organizationId, taskId: second });
    await rescheduleCallTask(as(tasker), { organizationId, taskId: third, dueAt: new Date(Date.now() + 7 * DAY).toISOString() });
    expect((await nextCallListEntry(as(caller), organizationId, query, []))!.task.id).toBe(fourth);
    // A selection held from before is read again as gone, not as it was.
    const page = await loadCallList(as(caller), organizationId, query, { selectedId: first });
    expect(page.selected).toBeNull();
    expect((await loadCallList(as(caller), organizationId, query, { selectedId: third })).selected).toMatchObject({ task: { id: third }, standing: { due: false, overdue: false } });
    expect(await counts(owner)).toMatchObject({ all: 28, overdue: 9, upcoming: 17 });
  });
});

describe('overdue follows the business’s own day', () => {
  /** A fixed-offset zone in which it is now this hour of the day. */
  const zoneAtHour = (hour: number) => {
    const utcHour = new Date().getUTCHours();
    // `Etc/GMT-N` is N hours ahead of UTC.
    let ahead = (hour - utcHour + 24) % 24;
    if (ahead > 14) ahead -= 24;
    return ahead >= 0 ? `Etc/GMT-${ahead}` : `Etc/GMT+${-ahead}`;
  };

  it('counts a call due four hours ago as overdue where the day began since, and only as due where it did not', async () => {
    const zoned = await account();
    const business = await foundBusiness({ ownerEmail: zoned.email, name: `Zoned ${tag}`, currency: 'XXX', timezone: 'America/Toronto' });
    const contact = await createContact(as(zoned), { organizationId: business, name: `Zoned contact ${tag}`, phone: number(7, 0) });
    await addToCallList(as(zoned), { organizationId: business, target: { customerIds: [contact] }, reason: 'Timezone', dueAt: new Date(Date.now() - 4 * HOUR).toISOString() });
    const standing = async (timezone: string) => {
      await pg.query('update public.organizations set timezone = $1 where id = $2', [timezone, business]);
      const [entry] = await listCallListEntries(as(zoned), { organizationId: business });
      return { ...entry.standing, overdueCount: (await callListCounts(as(zoned), { organizationId: business })).overdue };
    };
    // Where it is two in the morning, four hours ago was yesterday.
    expect(await standing(zoneAtHour(2))).toMatchObject({ due: true, overdue: true, overdueCount: 1 });
    // Where it is noon, four hours ago was this morning.
    expect(await standing(zoneAtHour(12))).toMatchObject({ due: true, overdue: false, overdueCount: 0 });
  });
});

describe('callbacks', () => {
  let contact: string, callId: string;
  const callWith = async (customerId: string | null, toNumber: string) => {
    const { data, error } = await open(owner, toNumber, customerId);
    if (error) throw error;
    return data as string;
  };

  beforeAll(async () => {
    contact = await createContact(as(owner), { organizationId, name: `Callback Cal ${tag}`, phone: number(8, 0) });
    await addToCallList(as(owner), { organizationId, target: { customerIds: [contact] }, reason: 'Annual review', dueAt: new Date(Date.now() - HOUR).toISOString(), ownerMembershipId: tasker.membershipId });
    callId = await callWith(contact, number(8, 0));
  });

  it('moves the contact’s one open call task and marks it a callback, without a second task', async () => {
    const before = await taskOf(contact);
    const when = new Date(Date.now() + 2 * DAY).toISOString();
    const task = await scheduleCallback(as(tasker), { organizationId, callId, dueAt: when });
    expect(task).toBe(before.id);
    const after = await openCalls(contact);
    expect(after).toHaveLength(1);
    // The same task: its reason and owner are kept; only when it is due changed.
    expect(after[0]).toMatchObject({ id: before.id, title: 'Annual review', ownerMembershipId: tasker.membershipId });
    expect(Date.parse(after[0].dueAt)).toBe(Date.parse(when));
    const [entry] = await view(owner, { view: 'callbacks', search: 'Callback Cal' });
    expect(entry).toMatchObject({ task: { id: before.id }, standing: { callback: true, due: false } });
    const { rows } = await pg.query('select callback_of_call_id from public.crm_tasks where id = $1', [before.id]);
    expect(rows[0].callback_of_call_id).toBe(callId);
    // The change is on the task's own history, attributed to who scheduled it.
    const events = await pg.query(`select actor_id from public.events where entity_id = $1 and action = 'follow_up.updated' order by occurred_at desc limit 1`, [before.id]);
    expect(events.rows).toHaveLength(1);
  });

  it('is a recorded fact, never read from a task’s wording', async () => {
    const wordy = await createContact(as(owner), { organizationId, name: `Wordy ${tag}`, phone: number(8, 1) });
    await addToCallList(as(owner), { organizationId, target: { customerIds: [wordy] }, reason: 'Callback requested: ring back after lunch', dueAt: new Date(Date.now() + DAY).toISOString() });
    const callbacks = await view(owner, { view: 'callbacks' });
    expect(callbacks.map(entry => entry.customer.id)).toEqual([contact]);
    expect((await view(owner, { search: 'Wordy' }))[0].standing.callback).toBe(false);
    expect((await counts(owner)).callbacks).toBe(1);
  });

  it('opens the call task with the reason given when the contact has none, and never invents a reason', async () => {
    const fresh = await createContact(as(owner), { organizationId, name: `Fresh Fay ${tag}`, phone: number(8, 2) });
    const call = await callWith(fresh, number(8, 2));
    const when = new Date(Date.now() + DAY).toISOString();
    await expect(scheduleCallback(as(tasker), { organizationId, callId: call, dueAt: when })).rejects.toThrow('Enter the reason for calling.');
    await expect(scheduleCallback(as(tasker), { organizationId, callId: call, dueAt: when, reason: '   ' })).rejects.toThrow('Enter the reason for calling.');
    expect(await openCalls(fresh)).toEqual([]);
    const task = await scheduleCallback(as(tasker), { organizationId, callId: call, dueAt: when, reason: ' Asked to be rung tomorrow ' });
    expect(await openCalls(fresh)).toMatchObject([{ id: task, title: 'Asked to be rung tomorrow', kind: 'call', ownerMembershipId: null }]);
    expect((await view(owner, { view: 'callbacks', search: 'Fresh Fay' }))).toHaveLength(1);
  });

  it('ends with one open call task when several people schedule the same callback at once', async () => {
    const raced = await createContact(as(owner), { organizationId, name: `Raced Rae ${tag}`, phone: number(8, 3) });
    const call = await callWith(raced, number(8, 3));
    const when = new Date(Date.now() + DAY).toISOString();
    const tasks = await Promise.all([owner, tasker, owner, tasker].map(person => scheduleCallback(as(person), { organizationId, callId: call, dueAt: when, reason: 'Race' })));
    expect(new Set(tasks).size).toBe(1);
    expect(await openCalls(raced)).toHaveLength(1);
  });

  it('refuses a call linked to nobody, an archived contact, a role without task permission and another business', async () => {
    const when = new Date(Date.now() + DAY).toISOString();
    const unlinked = await callWith(null, '+14165559998');
    await expect(scheduleCallback(as(owner), { organizationId, callId: unlinked, dueAt: when, reason: 'Nobody' })).rejects.toThrow('This call is not linked to a contact.');
    const archived = await createContact(as(owner), { organizationId, name: `Archived Ari ${tag}`, phone: number(8, 4) });
    const archivedCall = await callWith(archived, number(8, 4));
    await archiveContact(as(owner), { organizationId, contactId: archived });
    await expect(scheduleCallback(as(owner), { organizationId, callId: archivedCall, dueAt: when, reason: 'Archived' })).rejects.toThrow('This contact is archived.');
    // Placing calls is not managing tasks; viewing contacts is not either.
    for (const person of [caller, viewer, bystander, outsider]) {
      await expect(scheduleCallback(as(person), { organizationId, callId, dueAt: when })).rejects.toThrow('Your role cannot schedule callbacks.');
    }
    // The owner of another business cannot schedule against this one's call from their own.
    await expect(scheduleCallback(as(outsider), { organizationId: otherOrg, callId, dueAt: when, reason: 'Cross' })).rejects.toThrow('That call could not be found.');
    await expect(scheduleCallback(as(owner), { organizationId, callId, dueAt: 'soon' })).rejects.toThrow('Enter when to call back.');
    expect(await openCalls(archived)).toEqual([]);
  });
});

describe('rescheduling and reassigning a call on the list', () => {
  let contact: string;
  beforeAll(async () => {
    contact = await createContact(as(owner), { organizationId, name: `Movable Mo ${tag}`, phone: number(9, 0) });
    await addToCallList(as(owner), { organizationId, target: { customerIds: [contact] }, reason: 'Site visit', dueAt: new Date(Date.now() - HOUR).toISOString() });
  });

  it('moves the same task to the new time: nothing is created, cancelled or completed', async () => {
    const before = await taskOf(contact);
    const when = new Date(Date.now() + 3 * DAY).toISOString();
    await rescheduleCallTask(as(tasker), { organizationId, taskId: before.id, dueAt: when });
    const after = await openCalls(contact);
    expect(after).toMatchObject([{ id: before.id, title: 'Site visit', status: 'open' }]);
    expect(Date.parse(after[0].dueAt)).toBe(Date.parse(when));
    const all = await listTasks(as(owner), { organizationId, customerId: contact });
    expect(all).toHaveLength(1);
    expect((await view(owner, { search: 'Movable Mo' }))[0].standing).toMatchObject({ due: false, overdue: false, callback: false });
    await expect(rescheduleCallTask(as(tasker), { organizationId, taskId: before.id, dueAt: 'whenever' })).rejects.toThrow('Enter a valid date and time.');
  });

  it('gives the call to another member or to nobody, and shows it under their My calls', async () => {
    const task = await taskOf(contact);
    await reassignCallTask(as(owner), { organizationId, taskId: task.id, ownerMembershipId: tasker.membershipId! });
    expect((await view(tasker, { view: 'mine', search: 'Movable Mo' }))).toHaveLength(1);
    await reassignCallTask(as(owner), { organizationId, taskId: task.id, ownerMembershipId: null });
    expect((await view(tasker, { view: 'mine', search: 'Movable Mo' }))).toEqual([]);
    expect((await taskOf(contact)).ownerMembershipId).toBeNull();
    // A member of another business cannot be made the owner.
    const foreign = (await currentMembershipId(as(outsider), { organizationId: otherOrg }))!;
    await expect(reassignCallTask(as(owner), { organizationId, taskId: task.id, ownerMembershipId: foreign })).rejects.toThrow();
  });

  it('refuses a role without task permission, another business, and a task no longer on the list', async () => {
    const task = await taskOf(contact);
    const when = new Date(Date.now() + DAY).toISOString();
    for (const person of [caller, viewer, bystander, outsider]) {
      await expect(rescheduleCallTask(as(person), { organizationId, taskId: task.id, dueAt: when })).rejects.toThrow('This contact is no longer on the call list.');
      await expect(reassignCallTask(as(person), { organizationId, taskId: task.id, ownerMembershipId: null })).rejects.toThrow('This contact is no longer on the call list.');
    }
    expect((await taskOf(contact)).dueAt).toBe(task.dueAt);
    // Another kind of task is not a call on the list.
    const email = await createTask(as(owner), { organizationId, customerId: contact, kind: 'email', title: 'Send the brochure', dueAt: when });
    await expect(rescheduleCallTask(as(owner), { organizationId, taskId: email, dueAt: when })).rejects.toThrow('This contact is no longer on the call list.');
    await changeTaskStatus(as(owner), { organizationId, id: task.id, status: 'completed' });
    await expect(rescheduleCallTask(as(owner), { organizationId, taskId: task.id, dueAt: when })).rejects.toThrow('This contact is no longer on the call list.');
    expect(await openCalls(contact)).toEqual([]);
  });
});

describe('who may ring which number', () => {
  let onList: string, offList: string;
  const refusedAsManual = { code: '42501', message: expect.stringContaining('manual dialing') };

  beforeAll(async () => {
    onList = await createContact(as(owner), { organizationId, name: `Listed Lena ${tag}`, phone: number(10, 0) });
    offList = await createContact(as(owner), { organizationId, name: `Unlisted Uma ${tag}`, phone: number(10, 1) });
    await addToCallList(as(owner), { organizationId, target: { customerIds: [onList] }, reason: 'Welcome call' });
  });

  it('gives manual dialing to the founding administrator, and to no role merely because it places calls', async () => {
    const roles = await listRoles(as(owner), { organizationId });
    const holders = roles.filter(role => role.capabilities.includes('call.dial_manual')).map(role => role.name);
    expect(holders).toHaveLength(2);
    expect(roles.find(role => role.id === dialerRole)!.capabilities).toEqual(expect.arrayContaining(['call.place', 'call.dial_manual']));
    const placing = roles.filter(role => role.capabilities.includes('call.place'));
    expect(placing.length).toBeGreaterThan(holders.length);
  });

  it('lets a member who works the list call a listed contact at their recorded number, and nothing else', async () => {
    const listedCall = await open(caller, number(10, 0), onList);
    expect(listedCall.error).toBeNull();
    // The same number written another way is still theirs.
    expect((await open(caller, number(10, 0))).error).toBeNull();
    // A contact who is not on the list, for a caller who may not view contacts.
    expect((await open(caller, number(10, 1), offList)).error).toMatchObject(refusedAsManual);
    // Any other number, including with a listed contact named beside it: the number is what is rung.
    expect((await open(caller, '+14165557777')).error).toMatchObject(refusedAsManual);
    expect((await open(caller, '+14165557777', onList)).error).toMatchObject(refusedAsManual);
    // The call that was allowed records who placed it and where to.
    const { rows } = await pg.query('select created_by, to_number, customer_id, direction from public.calls where id = $1', [listedCall.data]);
    const { data: who } = await caller.db.auth.getUser();
    expect(rows[0]).toMatchObject({ created_by: who.user!.id, to_number: number(10, 0), customer_id: onList, direction: 'outbound' });
  });

  it('lets a member who may view contacts call any contact’s recorded number, but not a number of nobody', async () => {
    expect((await open(tasker, number(10, 1), offList)).error).toBeNull();
    expect((await open(tasker, '+14165557778')).error).toMatchObject(refusedAsManual);
  });

  it('lets a call the business received be returned without manual dialing', async () => {
    const callerNumber = '+14165553311';
    expect((await open(caller, callerNumber)).error).toMatchObject(refusedAsManual);
    const { data: who } = await owner.db.auth.getUser();
    await pg.query(
      `insert into public.calls (organization_id, direction, status, from_number, to_number, created_by) values ($1, 'inbound', 'no_answer', $2, '+14165550000', $3)`,
      [organizationId, callerNumber, who.user!.id],
    );
    expect((await open(caller, callerNumber)).error).toBeNull();
    // A call another business received is not this one's to return.
    const { data: them } = await outsider.db.auth.getUser();
    await pg.query(
      `insert into public.calls (organization_id, direction, status, from_number, to_number, created_by) values ($1, 'inbound', 'no_answer', '+14165553322', '+14165550000', $2)`,
      [otherOrg, them.user!.id],
    );
    expect((await open(caller, '+14165553322')).error).toMatchObject(refusedAsManual);
  });

  it('lets a member with manual dialing ring a number that belongs to nobody, such as their own mobile to test a line', async () => {
    const own = '+14165558800';
    const placed = await open(dialer, own);
    expect(placed.error).toBeNull();
    // Attributed like any call: who placed it, to which number, linked to no contact.
    const { rows } = await pg.query('select created_by, to_number, customer_id from public.calls where id = $1', [placed.data]);
    const { data: who } = await dialer.db.auth.getUser();
    expect(rows[0]).toMatchObject({ created_by: who.user!.id, to_number: own, customer_id: null });
  });

  it('stops at the next call when manual dialing or placing calls is taken away', async () => {
    await updateRoleCapabilities(as(owner), { roleId: dialerRole, name: `Manual dialer ${tag}`, capabilities: ['call.place'] });
    expect((await open(dialer, '+14165558801')).error).toMatchObject(refusedAsManual);
    // Still a caller: the list remains theirs to work.
    expect((await open(dialer, number(10, 0), onList)).error).toBeNull();
    await updateRoleCapabilities(as(owner), { roleId: dialerRole, name: `Manual dialer ${tag}`, capabilities: ['document.create'] });
    const refused = await open(dialer, number(10, 0), onList);
    expect(refused.error).toMatchObject({ code: '42501' });
    expect(refused.error!.message).not.toContain('manual dialing');
    await updateRoleCapabilities(as(owner), { roleId: dialerRole, name: `Manual dialer ${tag}`, capabilities: ['call.place', 'call.dial_manual'] });
    expect((await open(dialer, '+14165558801')).error).toBeNull();
  });

  it('refuses a member who may not place calls whatever the number, and tells them nothing about it', async () => {
    for (const person of [viewer, bystander]) {
      const refused = await open(person, number(10, 0), onList);
      expect(refused.error).toMatchObject({ code: '42501' });
      expect(refused.error!.message).not.toContain('manual dialing');
    }
  });

  it('holds manual dialing to the member’s own business', async () => {
    // The owner dials any number in their own business, and none in another.
    expect((await open(owner, '+14165558802')).error).toBeNull();
    expect((await open(owner, '+14165558802', null, otherOrg)).error).toMatchObject({ code: '42501' });
    const { rows } = await pg.query(`select count(*)::int as calls from public.calls where organization_id = $1 and direction = 'outbound'`, [otherOrg]);
    expect(rows[0].calls).toBe(0);
  });
});

describe('the call list never crosses businesses or roles', () => {
  it('is closed to another business’s members and to a member who neither places calls nor views contacts', async () => {
    for (const person of [outsider, bystander]) {
      await expect(view(person)).rejects.toThrow('Your role cannot see the call list.');
      await expect(counts(person)).rejects.toThrow('Your role cannot see the call list.');
      await expect(nextCallListEntry(as(person), organizationId, callListQuery({}), [])).rejects.toThrow('Your role cannot see the call list.');
    }
    // A viewer of contacts sees the list without being able to call from it.
    expect((await counts(viewer)).all).toBeGreaterThan(0);
  });

  it('shows a business only its own calls, however the question is asked', async () => {
    const theirs = await createContact(as(outsider), { organizationId: otherOrg, name: `Private ${tag}`, phone: number(11, 0) });
    await addToCallList(as(outsider), { organizationId: otherOrg, target: { customerIds: [theirs] }, reason: 'Private call' });
    const [privateTask] = await listTasks(as(outsider), { organizationId: otherOrg, customerId: theirs, status: 'open', kind: 'call' });
    expect((await listCallListEntries(as(outsider), { organizationId: otherOrg })).map(entry => entry.customer.id)).toEqual([theirs]);
    expect(await view(owner, { search: `Private ${tag}` })).toEqual([]);
    // Naming their task does not read it, move it or reassign it.
    expect(await listCallListEntries(as(owner), { organizationId, taskIds: [privateTask.id] })).toEqual([]);
    expect((await loadCallList(as(owner), organizationId, callListQuery({}), { selectedId: privateTask.id })).selected).toBeNull();
    await expect(rescheduleCallTask(as(owner), { organizationId, taskId: privateTask.id, dueAt: new Date().toISOString() })).rejects.toThrow('This contact is no longer on the call list.');
    await expect(rescheduleCallTask(as(owner), { organizationId: otherOrg, taskId: privateTask.id, dueAt: new Date().toISOString() })).rejects.toThrow('This contact is no longer on the call list.');
    expect((await listTasks(as(outsider), { organizationId: otherOrg, customerId: theirs }))[0].dueAt).toBe(privateTask.dueAt);
  });

  it('refuses a view it does not know rather than answering with every call', async () => {
    const { error } = await owner.db.rpc('call_list_page', { p_organization_id: organizationId, p_view: 'everything' });
    expect(error).toMatchObject({ code: '22023' });
    expect(callListQuery({ view: 'everything' as never }).view).toBe('all');
  });
});
