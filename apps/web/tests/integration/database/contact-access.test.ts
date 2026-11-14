import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import {
  archiveContact, contactRemovalCheck, createContact, deleteContact, getContact, listContactPage, listContacts, restoreContact, updateContact,
} from '@/lib/domain/contacts/contacts';
import { createRole, updateRoleCapabilities } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { createTask } from '@/lib/domain/tasks/tasks';
import { CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `contact-access-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db, userId: user.data.user.id };
}
type Account = Awaited<ReturnType<typeof account>>;
async function asPostgres<T>(work: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
  try { return await work(pg); } finally { await pg.end(); }
}

/**
 * `customer.read` and `customer.delete` at the database boundary: who sees contacts and through
 * which narrow doors, and how a contact leaves the business without losing what must be kept.
 */
describe('contact read and removal permissions under real PostgreSQL RLS', () => {
  let owner: Account, viewer: Account, creator: Account, editor: Account, caller: Account, deleter: Account, outsider: Account;
  let organizationId: string, otherOrg: string, viewerRole: string;
  let listed: string, unlisted: string, plain: string, kept: string, foreign: string;
  const tag = randomUUID().slice(0, 8);

  beforeAll(async () => {
    [owner, viewer, creator, editor, caller, deleter, outsider] = await Promise.all(Array.from({ length: 7 }, () => account()));
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Contact access business', currency: 'CAD' });
    otherOrg = await foundBusiness({ ownerEmail: outsider.email, name: 'Another business', currency: 'CAD' });
    const role = (name: string, capabilities: Capability[]) => createRole(owner.db, { organizationId, name, capabilities });
    let creatorRole: string, editorRole: string, callerRole: string, deleterRole: string;
    [viewerRole, creatorRole, editorRole, callerRole, deleterRole] = await Promise.all([
      role('Contact viewer', ['customer.read']),
      role('Adds without browsing', ['customer.create']),
      role('Editor', ['customer.read', 'customer.update']),
      // Places calls and manages tasks, but may not view the contact directory.
      role('Caller', ['call.place', 'follow_up.manage', 'message.send']),
      role('Contact remover', ['customer.read', 'customer.delete']),
    ]);
    await Promise.all([
      addMember(owner.db, { organizationId, email: viewer.email, roleId: viewerRole }),
      addMember(owner.db, { organizationId, email: creator.email, roleId: creatorRole }),
      addMember(owner.db, { organizationId, email: editor.email, roleId: editorRole }),
      addMember(owner.db, { organizationId, email: caller.email, roleId: callerRole }),
      addMember(owner.db, { organizationId, email: deleter.email, roleId: deleterRole }),
    ]);
    [listed, unlisted, plain, kept] = await Promise.all(['Listed', 'Unlisted', 'Plain', 'Kept'].map((name, index) =>
      createContact(owner.db, { organizationId, name: `${name} ${tag}`, email: `${name.toLowerCase()}-${tag}@example.test`, phone: `+1416555020${index}` })));
    foreign = await createContact(outsider.db, { organizationId: otherOrg, name: `Foreign ${tag}`, phone: '+14165550299' });
    await createTask(owner.db, { organizationId, customerId: listed, kind: 'call', title: 'Renewal', dueAt: new Date().toISOString() });
    await createTask(owner.db, { organizationId, customerId: kept, kind: 'email', title: 'Send quote', dueAt: new Date().toISOString() });
  });

  it('keeps the database list of permissions the same as the one in code', async () => {
    const known = await asPostgres(async pg => (await pg.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'roles_capabilities_known'")).rows[0].def);
    const listed = [...known.matchAll(/'([^']+)'::text/g)].map(match => match[1]).sort();
    expect(listed).toEqual([...CAPABILITIES].sort());
  });

  it('shows contacts, their details and their history only to a role that may view them', async () => {
    expect((await listContacts(viewer.db, { organizationId, search: tag })).map(contact => contact.id).sort()).toEqual([listed, unlisted, plain, kept].sort());
    expect(await getContact(viewer.db, { organizationId, customerId: listed })).toMatchObject({ id: listed, phone: '+14165550200' });
    for (const db of [caller.db, creator.db]) {
      expect(await listContacts(db, { organizationId, search: tag })).toEqual([]);
      expect(await getContact(db, { organizationId, customerId: listed })).toBeNull();
      expect((await db.from('contact_directory').select('id').eq('organization_id', organizationId)).data).toEqual([]);
      expect((await db.from('contact_people').select('contact_id').eq('organization_id', organizationId)).data).toEqual([]);
      // Contact history carries names; it follows the same permission. Task history does not.
      expect((await db.from('events').select('id').eq('organization_id', organizationId).eq('entity_type', 'customer')).data).toEqual([]);
    }
    expect((await viewer.db.from('events').select('id').eq('organization_id', organizationId).eq('entity_type', 'customer')).data?.length).toBeGreaterThan(0);
    expect((await caller.db.from('events').select('id').eq('organization_id', organizationId).eq('entity_type', 'follow_up')).data?.length).toBeGreaterThan(0);
    // Counts are contacts too.
    const overview = await caller.db.rpc('crm_relationship_overview', { p_organization_id: organizationId });
    expect(overview.data).toMatchObject({ total: 0 });
    expect((await caller.db.rpc('customers_not_contacted', { p_organization_id: organizationId })).data).toEqual([]);
  });

  it('keeps another workspace’s records readable while withholding the contact behind them', async () => {
    const tasks = await caller.db.from('crm_tasks').select('id, title, customer_id, customer:contacts!crm_follow_ups_organization_id_customer_id_fkey(name)').eq('organization_id', organizationId).eq('customer_id', listed);
    expect(tasks.data).toEqual([expect.objectContaining({ title: 'Renewal', customer_id: listed, customer: null })]);
  });

  it('shows a caller the name and number of contacts on the call list, and nothing else of the directory', async () => {
    const shown = await caller.db.rpc('call_list_contacts', { p_organization_id: organizationId, p_customer_ids: [listed, unlisted, foreign] });
    expect(shown.error).toBeNull();
    expect(shown.data).toEqual([{ id: listed, name: `Listed ${tag}`, email: `listed-${tag}@example.test`, phone: '+14165550200', archived: false }]);
    // Without calling or viewing permission there is no door at all.
    expect((await creator.db.rpc('call_list_contacts', { p_organization_id: organizationId, p_customer_ids: [listed] })).error?.code).toBe('42501');
    // Another business's call list is not this caller's.
    expect((await caller.db.rpc('call_list_contacts', { p_organization_id: otherOrg, p_customer_ids: [foreign] })).error?.code).toBe('42501');
    // Choosing who to call is browsing contacts, so task permission alone adds nobody.
    const added = await caller.db.rpc('add_call_list_entries', { p_organization_id: organizationId, p_customer_ids: [unlisted], p_title: 'Try', p_due_at: new Date().toISOString() });
    expect(added.data ?? []).toEqual([]);
  });

  it('lets a role add a contact it cannot browse, without reading it back or editing it', async () => {
    const id = await createContact(creator.db, { organizationId, name: `Created blind ${tag}`, phone: '+14165550290' });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await getContact(creator.db, { organizationId, customerId: id })).toBeNull();
    expect(await getContact(owner.db, { organizationId, customerId: id })).toMatchObject({ name: `Created blind ${tag}` });
    await expect(updateContact(creator.db, { organizationId, customerId: id, name: 'Changed' })).rejects.toThrow();
  });

  it('refuses archive, restore and deletion to every role without customer.delete, and to another business', async () => {
    for (const db of [viewer.db, editor.db, creator.db, caller.db, outsider.db]) {
      await expect(contactRemovalCheck(db, { organizationId, contactId: plain })).rejects.toMatchObject({ code: 'contacts.removal_forbidden' });
      await expect(archiveContact(db, { organizationId, contactId: plain })).rejects.toMatchObject({ code: 'contacts.removal_forbidden' });
      await expect(deleteContact(db, { organizationId, contactId: plain })).rejects.toMatchObject({ code: 'contacts.removal_forbidden' });
    }
    // A remover in this business cannot reach another business's contact through it.
    await expect(deleteContact(deleter.db, { organizationId, contactId: foreign })).rejects.toThrow('This contact no longer exists.');
    await expect(deleteContact(deleter.db, { organizationId: otherOrg, contactId: foreign })).rejects.toMatchObject({ code: 'contacts.removal_forbidden' });
    expect(await getContact(outsider.db, { organizationId: otherOrg, customerId: foreign })).not.toBeNull();
    expect(await getContact(owner.db, { organizationId, customerId: plain })).not.toBeNull();
  });

  it('refuses to delete a contact that records must keep, names only the kinds, and archives it instead', async () => {
    expect(await contactRemovalCheck(deleter.db, { organizationId, contactId: kept })).toEqual({ archived: false, retained: ['tasks'] });
    await expect(deleteContact(deleter.db, { organizationId, contactId: kept })).rejects.toThrow('This contact has records that must be kept. Archive it instead.');
    await archiveContact(deleter.db, { organizationId, contactId: kept });
    await expect(archiveContact(deleter.db, { organizationId, contactId: kept })).rejects.toThrow('This contact is already archived.');
    // Kept with its id and its task; gone from pickers and the directory's default view.
    expect(await getContact(viewer.db, { organizationId, customerId: kept })).toMatchObject({ id: kept, archivedAt: expect.any(String) });
    expect((await listContacts(viewer.db, { organizationId, search: tag })).map(contact => contact.id)).not.toContain(kept);
    expect((await listContactPage(viewer.db, { organizationId, filter: { search: tag, page: 1 } })).map(contact => contact.id)).not.toContain(kept);
    expect((await listContactPage(viewer.db, { organizationId, filter: { search: tag, archived: true, page: 1 } })).map(contact => contact.id)).toEqual([kept]);
    expect((await owner.db.from('crm_tasks').select('title, status').eq('organization_id', organizationId).eq('customer_id', kept)).data).toEqual([{ title: 'Send quote', status: 'open' }]);
    // An archived contact is not put on the call list.
    expect((await owner.db.rpc('add_call_list_entries', { p_organization_id: organizationId, p_customer_ids: [kept], p_title: 'Try', p_due_at: new Date().toISOString() })).data ?? []).toEqual([]);
    await restoreContact(deleter.db, { organizationId, contactId: kept });
    expect((await listContacts(viewer.db, { organizationId, search: tag })).map(contact => contact.id)).toContain(kept);
    const history = await asPostgres(async pg => (await pg.query<{ action: string; actor_id: string }>(
      "select action, actor_id from events where organization_id = $1 and entity_id = $2 and action in ('customer.archived', 'customer.restored') order by occurred_at, action", [organizationId, kept])).rows);
    expect(history).toEqual([{ action: 'customer.archived', actor_id: deleter.userId }, { action: 'customer.restored', actor_id: deleter.userId }]);
  });

  it('deletes a contact nothing must keep, recording who did it', async () => {
    expect(await contactRemovalCheck(deleter.db, { organizationId, contactId: plain })).toEqual({ archived: false, retained: [] });
    await deleteContact(deleter.db, { organizationId, contactId: plain });
    expect(await getContact(owner.db, { organizationId, customerId: plain })).toBeNull();
    await expect(deleteContact(deleter.db, { organizationId, contactId: plain })).rejects.toThrow('This contact no longer exists.');
    const event = await asPostgres(async pg => (await pg.query("select actor_id, payload from events where organization_id = $1 and entity_id = $2 and action = 'customer.deleted'", [organizationId, plain])).rows);
    expect(event).toEqual([{ actor_id: deleter.userId, payload: expect.objectContaining({ name: `Plain ${tag}` }) }]);
    // Removing from the call list is not deleting: the listed contact is still here.
    expect(await getContact(owner.db, { organizationId, customerId: listed })).not.toBeNull();
  });

  it('takes away viewing the moment a role loses customer.read', async () => {
    expect(await getContact(viewer.db, { organizationId, customerId: listed })).not.toBeNull();
    await updateRoleCapabilities(owner.db, { roleId: viewerRole, name: 'Contact viewer', capabilities: [] });
    expect(await getContact(viewer.db, { organizationId, customerId: listed })).toBeNull();
    expect(await listContacts(viewer.db, { organizationId })).toEqual([]);
    await updateRoleCapabilities(owner.db, { roleId: viewerRole, name: 'Contact viewer', capabilities: ['customer.read'] });
    expect(await getContact(viewer.db, { organizationId, customerId: listed })).not.toBeNull();
  });

  it('accounts for every table that refers to a contact before anything can be deleted', async () => {
    // A new reference to contacts must be decided: kept (added to app.contact_retained_records) or
    // deliberately allowed to go with the contact. This fails until that decision is made.
    const referencing = await asPostgres(async pg => (await pg.query<{ name: string }>(
      "select distinct conrelid::regclass::text as name from pg_constraint where confrelid = 'public.contacts'::regclass and contype = 'f' order by 1")).rows.map(row => row.name));
    const body = await asPostgres(async pg => (await pg.query<{ body: string }>("select prosrc as body from pg_proc where proname = 'contact_retained_records'")).rows[0].body);
    // Handled by deletion itself: the contact's own details go with it, its location links are
    // removed (with any place nothing else uses), and import history keeps its evidence.
    const handledByDeletion = ['contact_people', 'contact_companies', 'customer_locations', 'import_staging_rows'];
    const unaccounted = referencing.filter(name => !handledByDeletion.includes(name) && !body.includes(name.includes('.') ? name : `public.${name}`));
    expect(unaccounted).toEqual([]);
  });
});
