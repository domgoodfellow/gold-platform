import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createContact, getContact } from '@/lib/domain/contacts/contacts';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { changeTaskStatus, createTask, listTasks, updateTask } from '@/lib/domain/tasks/tasks';
import {
  addToCallList, callListAvailable, callListRemovalAvailable, findCallListCandidates, planCallListAdd, removeFromCallList, reviewCallListAdd,
} from '@/lib/application/communications/call-list';
import type { Capability } from '@/lib/domain/tenancy/capabilities';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `call-list-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db, userId: user.data.user.id };
}
async function asPostgres<T>(work: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
  try { return await work(pg); } finally { await pg.end(); }
}

describe('Dialer call list under real PostgreSQL RLS', () => {
  let owner: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>, limited: Awaited<ReturnType<typeof account>>;
  let tasker: Awaited<ReturnType<typeof account>>, remover: Awaited<ReturnType<typeof account>>, colleague: Awaited<ReturnType<typeof account>>;
  let organizationId: string, otherOrg: string, alice: string, bob: string, cara: string, dev: string, noPhone: string, privateContact: string;
  const tag = randomUUID().slice(0, 8);
  const openCalls = async (customerId: string) => (await listTasks(owner.db, { organizationId, customerId, status: 'open', kind: 'call' }));
  const ids = (...customerIds: string[]) => ({ customerIds });
  const member = (capabilities: Capability[]) => ({ id: organizationId, capabilities });

  beforeAll(async () => {
    [owner, outsider, limited, tasker, remover, colleague] = await Promise.all([account(), account(), account(), account(), account(), account()]);
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Call list business', currency: 'CAD', timezone: 'America/Toronto' });
    otherOrg = await foundBusiness({ ownerEmail: outsider.email, name: 'Private call list', currency: 'CAD' });
    [alice, bob, cara, dev] = await Promise.all(['Alice', 'Bob', 'Cara', 'Dev'].map((name, index) => createContact(owner.db, { organizationId, name: `${name} ${tag}`, phone: `+1416555010${index}` })));
    noPhone = await createContact(owner.db, { organizationId, name: `Nophone ${tag}` });
    privateContact = await createContact(outsider.db, { organizationId: otherOrg, name: `Private ${tag}`, phone: '+14165550199' });
    const [editorRole, taskRole, removerRole] = await Promise.all([
      createRole(owner.db, { organizationId, name: 'Contact editor', capabilities: ['customer.read', 'customer.update'] }),
      // Manages tasks, but was not given the call list's own removal permission.
      createRole(owner.db, { organizationId, name: 'Task manager', capabilities: ['customer.read', 'follow_up.manage', 'call.place'] }),
      createRole(owner.db, { organizationId, name: 'Call list keeper', capabilities: ['call_list.remove', 'call.place'] }),
    ]);
    await addMember(owner.db, { organizationId, email: limited.email, roleId: editorRole });
    await addMember(owner.db, { organizationId, email: tasker.email, roleId: taskRole });
    await addMember(owner.db, { organizationId, email: colleague.email, roleId: taskRole });
    await addMember(owner.db, { organizationId, email: remover.email, roleId: removerRole });
  });

  it('adds chosen contacts at once with the reason given, never twice, skipping anyone with no phone number', async () => {
    const now = new Date();
    expect(await addToCallList(owner.db, { organizationId, target: ids(alice, bob, alice), reason: '  Spring offer ', now })).toMatchObject({ added: 2, alreadyOnList: 0, noPhone: 0, conflicts: 0, outcomes: { [alice]: 'added', [bob]: 'added' } });
    const [aliceCall] = await openCalls(alice);
    expect(aliceCall).toMatchObject({ kind: 'call', status: 'open', title: 'Spring offer', ownerMembershipId: null });
    expect(Math.abs(Date.parse(aliceCall.dueAt) - now.getTime())).toBeLessThan(1000);
    expect(await addToCallList(owner.db, { organizationId, target: ids(alice, bob, cara, noPhone), reason: 'Renewal' })).toEqual({
      added: 1, alreadyOnList: 2, noPhone: 1, conflicts: 0, outcomes: { [alice]: 'on-list', [bob]: 'on-list', [cara]: 'added', [noPhone]: 'no-phone' },
    });
    expect((await openCalls(cara))[0].title).toBe('Renewal');
    expect(await openCalls(alice)).toHaveLength(1);
    expect(await openCalls(noPhone)).toEqual([]);
  });

  it('never invents a reason: a blank one is refused and nothing is added', async () => {
    for (const reason of [undefined, '', '   ']) {
      await expect(addToCallList(owner.db, { organizationId, target: ids(dev), reason })).rejects.toThrow('Enter the reason for calling.');
    }
    await expect(addToCallList(owner.db, { organizationId, target: ids(dev), reason: 'x'.repeat(201) })).rejects.toThrow('Keep the reason to 200 characters.');
    expect(await openCalls(dev)).toEqual([]);
  });

  it('reviews chosen contacts as they stand now: who can be added, who is already listed, who has no phone', async () => {
    const entries = await reviewCallListAdd(owner.db, { organizationId, customerIds: [alice, dev, noPhone] });
    expect(entries.map(({ id, standing }) => [id, standing])).toEqual([[alice, 'on-list'], [dev, 'ready'], [noPhone, 'no-phone']]);
    expect(entries[1]).toMatchObject({ name: `Dev ${tag}`, phone: '+14165550103' });
    await expect(reviewCallListAdd(owner.db, { organizationId, customerIds: [dev, privateContact] })).rejects.toThrow('One or more of these contacts is no longer available.');
  });

  it('adds everyone matching a Contacts view, and refuses rather than cuts short a view that is too large', async () => {
    const plan = await planCallListAdd(owner.db, { organizationId, target: { view: { search: tag } } });
    expect(plan).toMatchObject({ matching: 5, toAdd: [dev] });
    expect([plan.alreadyOnList.length, plan.noPhone.length]).toEqual([3, 1]);
    expect(await addToCallList(owner.db, { organizationId, target: { view: { search: tag } }, reason: 'Spring offer' })).toMatchObject({ added: 1, alreadyOnList: 3, noPhone: 1 });
    expect(await openCalls(dev)).toHaveLength(1);
    // A view of nobody adds nobody; another business's contacts never match.
    expect(await addToCallList(owner.db, { organizationId, target: { view: { search: `Private ${tag}` } }, reason: 'Spring offer' })).toMatchObject({ added: 0, alreadyOnList: 0, noPhone: 0 });
    await expect(planCallListAdd(owner.db, { organizationId, target: { view: { search: tag } }, matchingLimit: 4 })).rejects.toThrow('More than 4 contacts match. Narrow the search or filters first.');
    expect(await openCalls(noPhone)).toEqual([]);
  });

  it('marks who is already on the list; a completed call or another kind of task does not count', async () => {
    const extra = await createContact(owner.db, { organizationId, name: `Extra ${tag}`, phone: '+14165550120' });
    const done = await createTask(owner.db, { organizationId, customerId: extra, kind: 'call', title: 'Earlier call', dueAt: new Date().toISOString() });
    await changeTaskStatus(owner.db, { organizationId, id: done, status: 'completed' });
    await createTask(owner.db, { organizationId, customerId: extra, kind: 'email', title: 'Send the brochure', dueAt: new Date().toISOString() });
    const found = await findCallListCandidates(owner.db, { organizationId, search: tag });
    const byId = new Map(found.map(candidate => [candidate.id, candidate]));
    expect(byId.get(alice)).toMatchObject({ onList: true, phone: '+14165550100' });
    expect(byId.get(extra)).toMatchObject({ onList: false });
    expect(found.every(candidate => candidate.id !== privateContact)).toBe(true);
  });

  it('holds one open Call task per contact in the database, however it is created', async () => {
    await expect(createTask(owner.db, { organizationId, customerId: alice, kind: 'call', title: 'A second call', dueAt: new Date().toISOString() })).rejects.toThrow('This contact is already on the call list.');
    const [email] = await Promise.all([createTask(owner.db, { organizationId, customerId: alice, kind: 'email', title: 'Send a quote', dueAt: new Date().toISOString() })]);
    await expect(updateTask(owner.db, { id: email, organizationId, customerId: alice, kind: 'call', title: 'Send a quote', dueAt: new Date().toISOString() })).rejects.toThrow('This contact is already on the call list.');
    expect(await openCalls(alice)).toHaveLength(1);
  });

  it('adds a contact once when several people add them at the same moment, and counts the conflict', async () => {
    for (let round = 0; round < 3; round += 1) {
      const contact = await createContact(owner.db, { organizationId, name: `Race ${round} ${tag}`, phone: `+1416555020${round}` });
      const results = await Promise.all([owner, tasker, colleague, owner].map(person => addToCallList(person.db, { organizationId, target: ids(contact), reason: `Race ${round}` })));
      expect(await openCalls(contact)).toHaveLength(1);
      expect(results.reduce((sum, result) => sum + result.added, 0)).toBe(1);
      // Everyone else saw them already listed, or lost the race to add them: never an error, never a second entry.
      expect(results.reduce((sum, result) => sum + result.alreadyOnList + result.conflicts, 0)).toBe(3);
      for (const result of results) expect(['added', 'on-list', 'conflict']).toContain(result.outcomes[contact]);
    }
  });

  it('refuses another business, a role without task permission, unknown contacts, and adds nothing when any is refused', async () => {
    const fresh = await createContact(owner.db, { organizationId, name: `Fresh ${tag}`, phone: '+14165550130' });
    expect(await findCallListCandidates(outsider.db, { organizationId })).toEqual([]);
    await expect(addToCallList(outsider.db, { organizationId, target: ids(fresh), reason: 'Hello' })).rejects.toThrow('One or more of these contacts is no longer available.');
    await expect(addToCallList(limited.db, { organizationId, target: ids(fresh), reason: 'Hello' })).rejects.toThrow(/row-level security/);
    await expect(addToCallList(owner.db, { organizationId, target: ids(fresh, privateContact), reason: 'Hello' })).rejects.toThrow('One or more of these contacts is no longer available.');
    expect(await openCalls(fresh)).toEqual([]);
    expect(await listTasks(outsider.db, { organizationId: otherOrg, customerId: privateContact })).toEqual([]);
    await expect(addToCallList(owner.db, { organizationId, target: ids(), reason: 'Hello' })).rejects.toThrow('Choose at least one contact.');
    await expect(addToCallList(owner.db, { organizationId, target: { customerIds: Array.from({ length: 51 }, () => randomUUID()) }, reason: 'Hello' })).rejects.toThrow('Add up to 50 contacts at a time.');
  });

  it('offers the call list only to a member who may manage tasks in a business that has the Dialer', async () => {
    expect(await callListAvailable(owner.db, member(['customer.read', 'follow_up.manage', 'call.place']))).toBe(false);
    // The Dialer belongs to the calling module; a business has it once the module is on and entitled.
    await setModuleEnabled(owner.db, { organizationId, key: 'reception', enabled: true });
    await asPostgres(pg => pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Call list test fixture')", [organizationId, owner.userId]));
    expect(await callListAvailable(owner.db, member(['customer.read', 'follow_up.manage', 'call.place']))).toBe(true);
    // Choosing who to call is viewing contacts: task permission without `customer.read` is not enough.
    expect(await callListAvailable(owner.db, member(['follow_up.manage', 'call.place']))).toBe(false);
    expect(await callListAvailable(owner.db, member(['customer.read', 'call.place']))).toBe(false);
    // Removal is its own permission; managing tasks does not include it.
    expect(await callListRemovalAvailable(owner.db, member(['follow_up.manage', 'call.place']))).toBe(false);
    expect(await callListRemovalAvailable(owner.db, member(['call_list.remove', 'call.place']))).toBe(true);
  });

  it('removes an entry by cancelling its Call task, keeping the contact, their history and a call in progress', async () => {
    const [aliceCall] = await openCalls(alice);
    const earlier = await asPostgres(async pg => {
      // History written as the owner, so the event log records who, as it would have at the time.
      await pg.query('begin');
      await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: owner.userId, role: 'authenticated' })]);
      const done = await pg.query("insert into crm_tasks(organization_id,customer_id,kind,title,due_at,status,completed_at,completed_by,created_by) values($1,$2,'call','Last month',now() - interval '30 days','completed',now() - interval '29 days',$3,$3) returning id", [organizationId, alice, owner.userId]);
      const call = await pg.query("insert into calls(organization_id,direction,status,to_number,from_number,customer_id,note,created_by,answered_at) values($1,'outbound','in_progress','+14165550100','+14165550999',$2,'Talking now',$3,now()) returning id", [organizationId, alice, owner.userId]);
      await pg.query('commit');
      return { taskId: done.rows[0].id as string, callId: call.rows[0].id as string };
    });
    const before = await getContact(owner.db, { organizationId, customerId: alice });

    await removeFromCallList(owner.db, member(['call_list.remove', 'call.place']), aliceCall.id);

    expect(await openCalls(alice)).toEqual([]);
    expect((await listTasks(owner.db, { organizationId, id: aliceCall.id }))[0]).toMatchObject({ status: 'cancelled', title: 'Spring offer' });
    expect((await listTasks(owner.db, { organizationId, id: earlier.taskId }))[0]).toMatchObject({ status: 'completed', title: 'Last month' });
    expect(await getContact(owner.db, { organizationId, customerId: alice })).toEqual(before);
    await asPostgres(async pg => {
      expect((await pg.query('select status, note, ended_at from calls where id=$1', [earlier.callId])).rows[0]).toEqual({ status: 'in_progress', note: 'Talking now', ended_at: null });
      const events = await pg.query("select action, actor_id from events where organization_id=$1 and entity_id=$2 order by occurred_at", [organizationId, aliceCall.id]);
      expect(events.rows.map(row => row.action)).toEqual(['follow_up.created', 'follow_up.cancelled']);
      expect(events.rows[1].actor_id).toBe(owner.userId);
    });
    await expect(removeFromCallList(owner.db, member(['call_list.remove', 'call.place']), aliceCall.id)).rejects.toThrow('This contact is no longer on the call list.');
  });

  it('lets a contact be added again once their Call task is cancelled or completed', async () => {
    expect(await addToCallList(owner.db, { organizationId, target: ids(alice), reason: 'Second try' })).toMatchObject({ added: 1 });
    const [again] = await openCalls(alice);
    await changeTaskStatus(owner.db, { organizationId, id: again.id, status: 'completed' });
    expect(await addToCallList(owner.db, { organizationId, target: ids(alice), reason: 'Third try' })).toMatchObject({ added: 1 });
    expect((await openCalls(alice)).map(task => task.title)).toEqual(['Third try']);
  });

  it('refuses removal without call_list.remove however it is attempted, while task permission still completes the call', async () => {
    const [bobCall] = await openCalls(bob);
    // The application refuses before asking the database.
    await expect(removeFromCallList(tasker.db, member(['follow_up.manage', 'call.place']), bobCall.id)).rejects.toThrow('Your role cannot remove contacts from the call list.');
    // Cancelling it as an ordinary task, turning it into another kind, the old view, or the function directly: all refused.
    await expect(changeTaskStatus(tasker.db, { organizationId, id: bobCall.id, status: 'cancelled' })).rejects.toThrow('Your role cannot remove contacts from the call list.');
    await expect(updateTask(tasker.db, { id: bobCall.id, organizationId, customerId: bob, kind: 'task', title: bobCall.title, dueAt: bobCall.dueAt })).rejects.toThrow('Your role cannot remove contacts from the call list.');
    const viaView = await tasker.db.from('crm_follow_ups').update({ status: 'cancelled' }).eq('organization_id', organizationId).eq('id', bobCall.id).select('id');
    expect(viaView.error?.message).toContain('Your role cannot remove contacts from the call list.');
    const viaFunction = await tasker.db.rpc('remove_from_call_list', { p_organization_id: organizationId, p_task_id: bobCall.id });
    expect(viaFunction.error?.code).toBe('42501');
    // Another business's member, naming this business or their own.
    for (const organization of [organizationId, otherOrg]) {
      const foreign = await outsider.db.rpc('remove_from_call_list', { p_organization_id: organization, p_task_id: bobCall.id });
      expect(foreign.error?.code).toMatch(/42501|P0002/);
    }
    expect((await openCalls(bob)).map(task => task.id)).toEqual([bobCall.id]);
    // Editing details and completing the call stay with task permission.
    await updateTask(tasker.db, { id: bobCall.id, organizationId, customerId: bob, kind: 'call', title: 'Renewal, call after 3', dueAt: bobCall.dueAt });
    await changeTaskStatus(tasker.db, { organizationId, id: bobCall.id, status: 'completed' });
    expect(await openCalls(bob)).toEqual([]);
  });

  it('lets a member with only call_list.remove take someone off the list, and nothing else', async () => {
    const [caraCall] = await openCalls(cara);
    const email = await createTask(owner.db, { organizationId, customerId: cara, kind: 'email', title: 'Send the brochure', dueAt: new Date().toISOString() });
    // Without task permission, an ordinary task is not theirs to cancel.
    await expect(changeTaskStatus(remover.db, { organizationId, id: email, status: 'cancelled' })).rejects.toThrow();
    await removeFromCallList(remover.db, member(['call_list.remove', 'call.place']), caraCall.id);
    expect(await openCalls(cara)).toEqual([]);
    expect((await listTasks(owner.db, { organizationId, id: email }))[0].status).toBe('open');
  });
});
