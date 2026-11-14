import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { foundBusiness } from '@/tests/support/founding';
import { archiveContact, contactRemovalCheck, createContact, deleteContact, getContact } from '@/lib/domain/contacts/contacts';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { createForm, formSubmissionCustomerCandidates, listFormSubmissions, publishFormRevision, saveFormDraft } from '@/lib/domain/forms/forms';
import { commandMarketing, readMarketing } from '@/lib/domain/marketing/marketing';
import { getConversationDetail } from '@/lib/domain/reception/inbox';
import { createLocation, linkCustomerLocation } from '@/lib/domain/locations/locations';
import type { Db } from '@/lib/db/types';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', options);
async function account() {
  const email = `contact-names-${randomUUID()}@example.test`; const password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY ?? '', options) as unknown as Db;
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  return { email, db, userId: user.data.user.id };
}
type Account = Awaited<ReturnType<typeof account>>;
async function asPostgres<T>(work: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
  try { return await work(pg); } finally { await pg.end(); }
}

/**
 * Contact names that other workspaces show (Marketing, form responses, Conversations) follow
 * `customer.read`, and permanent deletion removes a contact's disposable references only.
 */
describe('contact names outside Contacts, and what deletion removes', () => {
  let owner: Account, marketer: Account, siteManager: Account, messenger: Account;
  let organizationId: string, lia: string, conversationId: string, formId: string, submissionId: string, inquiryId: string, audienceId: string;
  const tag = randomUUID().slice(0, 8);
  const liaEmail = `lia-${tag}@example.test`;

  beforeAll(async () => {
    [owner, marketer, siteManager, messenger] = await Promise.all(Array.from({ length: 4 }, () => account()));
    organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Contact names business', currency: 'CAD' });
    // None of these roles may view contacts; each holds what its own workspace needs.
    const roles = await Promise.all([
      createRole(owner.db, { organizationId, name: 'Marketer', capabilities: ['marketing.read', 'marketing.manage'] }),
      createRole(owner.db, { organizationId, name: 'Site manager', capabilities: ['organization.manage'] }),
      createRole(owner.db, { organizationId, name: 'Messenger', capabilities: ['message.send'] }),
    ]);
    await Promise.all([marketer, siteManager, messenger].map((who, index) => addMember(owner.db, { organizationId, email: who.email, roleId: roles[index] })));
    lia = await createContact(owner.db, { organizationId, name: `Linked Lia ${tag}`, email: liaEmail, phone: '+14165550401' });
    const created = await createForm(owner.db, { organizationId, name: `Enquiry ${tag}` });
    formId = created.formId;
    await saveFormDraft(owner.db, { organizationId, revisionId: created.revisionId, definition: {
      title: 'Enquiry', submitLabel: 'Send', confirmation: { title: 'Thanks', message: 'Thanks.' },
      fields: [{ id: 'email', type: 'email', label: 'Email', required: true }],
    } as never });
    await publishFormRevision(owner.db, { organizationId, revisionId: created.revisionId });
    await asPostgres(async pg => {
      submissionId = (await pg.query<{ id: string }>(`insert into public.form_submissions (organization_id, form_id, form_revision_id, submitted_by, answers, customer_id)
        values ($1, $2, $3, $4, jsonb_build_object('email', $5::text), $6) returning id`, [organizationId, formId, created.revisionId, owner.userId, liaEmail, lia])).rows[0].id;
      inquiryId = (await pg.query<{ id: string }>(`insert into public.marketing_inquiries (organization_id, submission_id, form_id, source, form_name_at_capture, customer_id, occurred_at)
        values ($1, $2, $3, 'hosted', 'Enquiry', $4, now()) returning id`, [organizationId, submissionId, formId, lia])).rows[0].id;
      const number = (await pg.query<{ id: string }>("insert into public.phone_numbers (organization_id, e164, origin, voice_inbound_enabled, sms_inbound_enabled) values ($1, $2, 'external', false, false) returning id",
        [organizationId, `+1416${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`])).rows[0].id;
      conversationId = (await pg.query<{ id: string }>("insert into public.conversations (organization_id, customer_id, phone_number_id, external_number) values ($1, $2, $3, '+14165550401') returning id",
        [organizationId, lia, number])).rows[0].id;
    });
    audienceId = await commandMarketing(owner.db, organizationId, 'audience.save', { name: `Everyone ${tag}` });
  });

  it('Marketing names a linked contact and audience members only to customer.read, and refuses its contact search without it', async () => {
    type Inquiry = { customer_name: string | null };
    type Audience = { total: number; customers: { name: string }[] };
    expect((await readMarketing<Inquiry>(owner.db, organizationId, 'inquiry', { id: inquiryId })).customer_name).toBe(`Linked Lia ${tag}`);
    expect((await readMarketing<Inquiry>(marketer.db, organizationId, 'inquiry', { id: inquiryId })).customer_name).toBeNull();
    const hidden = await readMarketing<Audience>(marketer.db, organizationId, 'audience', { id: audienceId });
    // The audience's size is Marketing's own figure; who is in it is contact data.
    expect(hidden.total).toBeGreaterThan(0);
    expect(hidden.customers).toEqual([]);
    expect((await readMarketing<Audience>(owner.db, organizationId, 'audience', { id: audienceId })).customers.map(c => c.name)).toContain(`Linked Lia ${tag}`);
    const search = await marketer.db.rpc('marketing_read', { p_organization_id: organizationId, p_view: 'customers', p_filters: { q: 'Lia' } });
    expect(search.error?.code).toBe('42501');
  });

  it('form responses name and suggest contacts only to customer.read', async () => {
    expect(JSON.stringify(await listFormSubmissions(owner.db, organizationId, formId))).toContain(`Linked Lia ${tag}`);
    expect(JSON.stringify(await listFormSubmissions(siteManager.db, organizationId, formId))).not.toContain(`Linked Lia ${tag}`);
    expect((await formSubmissionCustomerCandidates(owner.db, organizationId, submissionId)).map(c => c.id)).toEqual([lia]);
    expect(await formSubmissionCustomerCandidates(siteManager.db, organizationId, submissionId)).toEqual([]);
  });

  it('a conversation linked to a contact says so without naming them to a role that may not view contacts', async () => {
    expect((await getConversationDetail(owner.db, { organizationId, conversationId }))?.resolution).toMatchObject({ state: 'resolved', customer: { id: lia } });
    const hidden = await getConversationDetail(messenger.db, { organizationId, conversationId });
    expect(hidden?.resolution).toEqual({ state: 'restricted' });
    expect(JSON.stringify(hidden)).not.toContain('Linked Lia');
    expect((await messenger.db.rpc('conversation_customer_candidates', { p_organization_id: organizationId, p_conversation_id: conversationId })).data ?? []).toEqual([]);
  });

  it('deletes a person with a place nothing else uses, removing the place too', async () => {
    const person = await createContact(owner.db, { organizationId, name: `Placed Pat ${tag}`, contactType: 'person' });
    const place = await createLocation(owner.db, { organizationId, label: 'Home', address: `1 Private Lane ${tag}` });
    await linkCustomerLocation(owner.db, { organizationId, customerId: person, locationId: place });
    expect(await contactRemovalCheck(owner.db, { organizationId, contactId: person })).toEqual({ archived: false, retained: [] });
    await deleteContact(owner.db, { organizationId, contactId: person });
    const left = await asPostgres(async pg => ({
      contact: (await pg.query('select 1 from contacts where id = $1', [person])).rowCount,
      place: (await pg.query('select 1 from locations where id = $1', [place])).rowCount,
      details: (await pg.query('select 1 from contact_people where contact_id = $1', [person])).rowCount,
      event: (await pg.query("select payload from events where entity_id = $1 and action = 'customer.deleted'", [person])).rows[0]?.payload,
    }));
    expect(left).toMatchObject({ contact: 0, place: 0, details: 0, event: { location_links_removed: 1, places_removed: 1 } });
  });

  it('keeps a place another contact still uses, and only drops the deleted contact’s link', async () => {
    const [one, two] = await Promise.all([`Shared One ${tag}`, `Shared Two ${tag}`].map(name => createContact(owner.db, { organizationId, name, contactType: 'person' })));
    const office = await createLocation(owner.db, { organizationId, label: 'Office', address: `2 Shared Street ${tag}` });
    await linkCustomerLocation(owner.db, { organizationId, customerId: one, locationId: office });
    await linkCustomerLocation(owner.db, { organizationId, customerId: two, locationId: office });
    await deleteContact(owner.db, { organizationId, contactId: one });
    expect(await asPostgres(async pg => (await pg.query('select customer_id from customer_locations where location_id = $1', [office])).rows)).toEqual([{ customer_id: two }]);
  });

  it('keeps a person or a company that an affiliation joins: archive, never delete; a company with nobody is deletable', async () => {
    const company = await createContact(owner.db, { organizationId, name: `Firm ${tag}`, contactType: 'company' });
    const employee = await createContact(owner.db, { organizationId, name: `Employee ${tag}`, contactType: 'person', companyId: company });
    const loneCompany = await createContact(owner.db, { organizationId, name: `Lone Firm ${tag}`, contactType: 'company' });
    for (const contactId of [company, employee]) {
      expect(await contactRemovalCheck(owner.db, { organizationId, contactId })).toEqual({ archived: false, retained: ['affiliations'] });
      await expect(deleteContact(owner.db, { organizationId, contactId })).rejects.toThrow('Archive it instead.');
    }
    await archiveContact(owner.db, { organizationId, contactId: company });
    expect(await getContact(owner.db, { organizationId, customerId: employee })).toMatchObject({ companyId: company });
    await deleteContact(owner.db, { organizationId, contactId: loneCompany });
    expect(await asPostgres(async pg => (await pg.query('select 1 from contact_companies where contact_id = $1', [loneCompany])).rowCount)).toBe(0);
  });

  it('leaves every authorization trigger switched on after the migrations', async () => {
    const triggers = await asPostgres(async pg => (await pg.query<{ tgname: string; tgenabled: string }>(
      "select tgname, tgenabled from pg_trigger where tgname in ('roles_capabilities_update_guard', 'roles_grant_guard', 'follow_up_observed', 'call_list_removal_guarded') order by tgname")).rows);
    expect(triggers).toEqual(['call_list_removal_guarded', 'follow_up_observed', 'roles_capabilities_update_guard', 'roles_grant_guard'].map(tgname => ({ tgname, tgenabled: 'O' })));
  });

  it('accounts for every table that refers to a location before a place is removed with its contact', async () => {
    const referencing = await asPostgres(async pg => (await pg.query<{ name: string }>(
      "select distinct conrelid::regclass::text as name from pg_constraint where confrelid = 'public.locations'::regclass and contype = 'f' order by 1")).rows.map(row => row.name));
    const body = await asPostgres(async pg => (await pg.query<{ body: string }>("select prosrc as body from pg_proc where proname = 'delete_contact'")).rows[0].body);
    expect(referencing.filter(name => !body.includes(`public.${name}`))).toEqual([]);
  });
});
