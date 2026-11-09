import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { createContact } from '@/lib/domain/contacts/contacts';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { changeTaskStatus, createTask, listTasks } from '@/lib/domain/tasks/tasks';
import { addToCallList, callListAvailable, findCallListCandidates, planCallListAdd } from '@/lib/application/communications/call-list';

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

describe('Dialer call list under real PostgreSQL RLS', () => {
  let owner: Awaited<ReturnType<typeof account>>, outsider: Awaited<ReturnType<typeof account>>, limited: Awaited<ReturnType<typeof account>>;
  let organizationId: string, otherOrg: string, alice: string, bob: string, cara: string, dev: string, noPhone: string, privateContact: string;
  const tag = randomUUID().slice(0, 8);
  const openCalls = async (customerId: string) => (await listTasks(owner.db, { organizationId, customerId, status: 'open', kind: 'call' }));
  const ids = (...customerIds: string[]) => ({ customerIds });

  beforeAll(async () => {
    [owner, outsider, limited] = await Promise.all([account(), account(), account()]);
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Call list business', currency: 'CAD', timezone: 'America/Toronto' });
    otherOrg = await foundBusiness({ ownerEmail: outsider.email, name: 'Private call list', currency: 'CAD' });
    [alice, bob, cara, dev] = await Promise.all(['Alice', 'Bob', 'Cara', 'Dev'].map((name, index) => createContact(owner.db, { organizationId, name: `${name} ${tag}`, phone: `+1416555010${index}` })));
    noPhone = await createContact(owner.db, { organizationId, name: `Nophone ${tag}` });
    privateContact = await createContact(outsider.db, { organizationId: otherOrg, name: `Private ${tag}`, phone: '+14165550199' });
    const roleId = await createRole(owner.db, { organizationId, name: 'Contact editor', capabilities: ['customer.update'] });
    await addMember(owner.db, { organizationId, email: limited.email, roleId });
  });

  it('adds chosen contacts at once, due now and unassigned, never twice, skipping anyone with no phone number', async () => {
    const now = new Date();
    expect(await addToCallList(owner.db, { organizationId, target: ids(alice, bob, alice), reason: '  Spring offer ', now })).toEqual({ added: 2, alreadyOnList: 0, noPhone: 0 });
    const [aliceCall] = await openCalls(alice);
    expect(aliceCall).toMatchObject({ kind: 'call', status: 'open', title: 'Spring offer', ownerMembershipId: null });
    expect(Math.abs(Date.parse(aliceCall.dueAt) - now.getTime())).toBeLessThan(1000);
    expect(await addToCallList(owner.db, { organizationId, target: ids(alice, bob, cara, noPhone) })).toEqual({ added: 1, alreadyOnList: 2, noPhone: 1 });
    expect((await openCalls(cara))[0].title).toBe('Call');
    expect(await openCalls(alice)).toHaveLength(1);
    expect(await openCalls(noPhone)).toEqual([]);
  });

  it('adds everyone matching a Contacts view, and refuses rather than cuts short a view that is too large', async () => {
    expect(await planCallListAdd(owner.db, { organizationId, target: { view: { search: tag } } })).toMatchObject({ matching: 5, alreadyOnList: 3, noPhone: 1, toAdd: [dev] });
    expect(await addToCallList(owner.db, { organizationId, target: { view: { search: tag } } })).toEqual({ added: 1, alreadyOnList: 3, noPhone: 1 });
    expect(await openCalls(dev)).toHaveLength(1);
    // A view of nobody adds nobody; another business's contacts never match.
    expect(await addToCallList(owner.db, { organizationId, target: { view: { search: `Private ${tag}` } } })).toEqual({ added: 0, alreadyOnList: 0, noPhone: 0 });
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

  it('refuses another business, a role without task permission, unknown contacts, and adds nothing when any is refused', async () => {
    const fresh = await createContact(owner.db, { organizationId, name: `Fresh ${tag}`, phone: '+14165550130' });
    expect(await findCallListCandidates(outsider.db, { organizationId })).toEqual([]);
    await expect(addToCallList(outsider.db, { organizationId, target: ids(fresh) })).rejects.toBeInstanceOf(Error);
    await expect(addToCallList(limited.db, { organizationId, target: ids(fresh) })).rejects.toBeInstanceOf(Error);
    await expect(addToCallList(owner.db, { organizationId, target: ids(fresh, privateContact) })).rejects.toThrow('One or more of these contacts is no longer available.');
    expect(await openCalls(fresh)).toEqual([]);
    expect(await listTasks(outsider.db, { organizationId: otherOrg, customerId: privateContact })).toEqual([]);
    await expect(addToCallList(owner.db, { organizationId, target: ids() })).rejects.toThrow('Choose at least one contact.');
    await expect(addToCallList(owner.db, { organizationId, target: { customerIds: Array.from({ length: 51 }, () => randomUUID()) } })).rejects.toThrow('Add up to 50 contacts at a time.');
  });

  it('offers the call list only to a member who may manage tasks in a business that has the Dialer', async () => {
    const member = { id: organizationId, capabilities: ['follow_up.manage', 'call.place'] as const };
    expect(await callListAvailable(owner.db, { ...member, capabilities: [...member.capabilities] })).toBe(false);
    // The Dialer belongs to the calling module; a business has it once the module is on and entitled.
    await setModuleEnabled(owner.db, { organizationId, key: 'reception', enabled: true });
    const pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
    try {
      await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Call list test fixture')", [organizationId, owner.userId]);
    } finally { await pg.end(); }
    expect(await callListAvailable(owner.db, { ...member, capabilities: [...member.capabilities] })).toBe(true);
    expect(await callListAvailable(owner.db, { id: organizationId, capabilities: ['call.place'] })).toBe(false);
  });
});
