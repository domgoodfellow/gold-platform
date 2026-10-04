import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createEmailIdentity } from '@/lib/domain/email/identities';
import { beginProviderBinding, recordProviderResource } from '@/lib/domain/providers/bindings';
import {
  assignConversation,
  claimConversation,
  createCustomerFromConversation,
  currentMembershipId,
  getConversationDetail,
  getInboxCounts,
  linkConversationCustomer,
  listAssignableMembers,
  listInbox,
  releaseConversation,
  setConversationStatus,
} from '@/lib/domain/reception/inbox';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * The Inbox, a conversation's status, who is handling it and who it is about — against real Postgres
 * and real RLS, as real signed-in people. SMS and email conversations are made the way their own
 * writers make them, so what is proved is the unified view over genuinely different channels.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PASSWORD = 'inbox-test-pw';

type Person = { db: SupabaseClient; userId: string; membershipId: string };
type Tenant = {
  organizationId: string;
  owner: Person;
  sarah: Person;
  viewer: Person;
  numberId: string;
  e164: string;
  identityId: string;
  address: string;
};

let pg: Client;
let staff: SupabaseClient;
let mine: Tenant;
let other: Tenant;

/** A business number nobody else holds: the carrier's webhook finds a business by the number alone, so a number reused across runs would land in an old one. */
const freshNumber = () => `+1416${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

async function account(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  return { email, userId: created.data.user.id };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const result = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (result.error) throw result.error;
  return db;
}

async function newTenant(label: string, e164: string): Promise<Tenant> {
  const owner = await account(`${label}-owner`);
  const sarah = await account(`${label}-sarah`);
  const viewer = await account(`${label}-viewer`);
  const organizationId = await foundBusiness({ ownerEmail: owner.email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: 'XXX' });
  const ownerDb = await signIn(owner.email);

  const handler = await createRole(ownerDb as never, { organizationId, name: 'Handler', capabilities: ['message.send', 'customer.create'] });
  const reader = await createRole(ownerDb as never, { organizationId, name: 'Reader', capabilities: ['customer.create'] });
  await addMember(ownerDb as never, { organizationId, email: sarah.email, displayName: 'Sarah Handler', roleId: handler });
  await addMember(ownerDb as never, { organizationId, email: viewer.email, displayName: 'Vic Viewer', roleId: reader });
  const sarahDb = await signIn(sarah.email);
  const viewerDb = await signIn(viewer.email);

  const person = async (db: SupabaseClient, userId: string): Promise<Person> => ({
    db, userId, membershipId: (await currentMembershipId(db as never, { organizationId }))!,
  });

  // A phone number through the staff door, and an email address beneath an active sending domain.
  await beginProviderBinding(staff, { organizationId, providerKey: 'twilio' });
  const resourceId = await recordProviderResource(staff, {
    organizationId, providerKey: 'twilio', resourceType: 'twilio_phone_number', externalId: `PN${randomUUID().replace(/-/g, '').slice(0, 32)}`,
  });
  const synced = await staff.rpc('sync_phone_number', { p_organization_id: organizationId, p_provider_resource_id: resourceId, p_e164: e164 });
  if (synced.error) throw synced.error;

  const domain = `${label}-${randomUUID().slice(0, 6)}.example.test`;
  const named = await ownerDb.rpc('record_organization_email_domain', { p_organization_id: organizationId, p_domain: domain });
  if (named.error) throw named.error;
  const address = `hello@${domain}`;
  const identity = await createEmailIdentity(ownerDb as never, { organizationId, address, sendingDomainResourceId: named.data as string });
  await pg.query('begin');
  await pg.query('set local role provider_operator');
  await pg.query(`select public.record_email_domain_provisioning($1, $2, 'active')`, [organizationId, named.data]);
  await pg.query('commit');
  await ownerDb.from('email_identities').update({ can_receive: true }).eq('id', identity.id);

  return {
    organizationId, owner: await person(ownerDb, owner.userId), sarah: await person(sarahDb, sarah.userId), viewer: await person(viewerDb, viewer.userId),
    numberId: synced.data as string, e164, identityId: identity.id, address,
  };
}

async function asRole<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await pg.query('begin');
  try {
    await pg.query(`set local role ${role}`);
    const result = await pg.query(sql, params);
    await pg.query('commit');
    return result.rows as T[];
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

/** An inbound text the way the carrier's webhook writes it. Returns the conversation it landed in. */
async function inboundSms(tenant: Tenant, from: string, body = 'Hello there'): Promise<string> {
  await asRole('sms_webhook', `select public.record_inbound_message($1, $2, $3, $4)`, [tenant.e164, from, `SM${randomUUID()}`, body]);
  const { rows } = await pg.query(`select id from public.conversations where organization_id = $1 and external_number = $2`, [tenant.organizationId, from]);
  return rows[0].id as string;
}

/** An inbound email the way the provider webhook writes it. */
async function inboundEmail(tenant: Tenant, from: string, subject = 'A question', inReplyTo: string | null = null): Promise<string> {
  const rows = await asRole<{ r: { message_id: string } }>(
    'tenant_email_webhook',
    `select public.record_inbound_email($1, $2, $3, $4, $5, $6, '{}', $7, 'Please advise', null, now(), null, '[]'::jsonb) as r`,
    [[tenant.address], from, `in_${randomUUID()}`, `evt_${randomUUID()}`, `<${randomUUID()}@x.test>`, inReplyTo, subject],
  );
  const { rows: conv } = await pg.query(`select conversation_id from public.messages where id = $1`, [rows[0].r.message_id]);
  return conv[0].conversation_id as string;
}

const inbox = (tenant: Tenant, who: Person, filter: Parameters<typeof listInbox>[1]['filter'] = {}, extra: { cursor?: string | null; limit?: number } = {}) =>
  listInbox(who.db as never, { organizationId: tenant.organizationId, filter, membershipId: who.membershipId, ...extra });
const ids = async (tenant: Tenant, who: Person, filter: Parameters<typeof listInbox>[1]['filter'] = {}) => (await inbox(tenant, who, filter)).items.map((i) => i.id);
const statusOf = async (id: string) => (await pg.query(`select status, unread, assignee_membership_id, customer_id from public.conversations where id = $1`, [id])).rows[0];
const actions = async (id: string) => (await pg.query(`select action from public.events where entity_type = 'conversation' and entity_id = $1 order by occurred_at, id`, [id])).rows.map((r) => r.action as string);

beforeAll(async () => {
  pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  staff = await asPlatformStaff();
  [mine, other] = await Promise.all([newTenant('ib-a', freshNumber()), newTenant('ib-b', freshNumber())]);
}, 180_000);

afterAll(async () => {
  await pg.end();
});

describe('one Inbox over both channels', () => {
  let sms: string;
  let email: string;
  let both: Tenant;

  beforeAll(async () => {
    both = await newTenant('ib-c', freshNumber());
    sms = await inboundSms(both, '+14165550801', 'Can you come Thursday?');
    email = await inboundEmail(both, 'kim@example.test', 'Your quote');
  }, 60_000);

  it('shows a text and an email together, newest activity first, with the channel and the right words for each', async () => {
    const { items } = await inbox(both, both.owner);
    expect(items.map((i) => i.id)).toEqual([email, sms]);
    expect(items[0]).toMatchObject({ channel: 'email', title: 'kim@example.test', subject: 'Your quote', status: 'open', unread: true, assignee: null, customer: null });
    expect(items[1]).toMatchObject({ channel: 'sms', title: '+14165550801', subject: null });
  });

  it('carries no provider identifier on a row', async () => {
    const [row] = (await inbox(both, both.owner)).items;
    expect(Object.keys(row).sort()).toEqual(
      ['assignee', 'channel', 'customer', 'externalAddress', 'id', 'lastActivityAt', 'preview', 'status', 'subject', 'title', 'unread'],
    );
  });

  it('filters by channel', async () => {
    expect(await ids(both, both.owner, { channel: 'sms' })).toEqual([sms]);
    expect(await ids(both, both.owner, { channel: 'email' })).toEqual([email]);
  });

  it('filters by unread, and a conversation read by somebody stops being unread for everyone', async () => {
    expect((await ids(both, both.owner, { view: 'unread' })).sort()).toEqual([email, sms].sort());
    await both.owner.db.from('conversations').update({ unread: false }).eq('id', sms);
    expect(await ids(both, both.owner, { view: 'unread' })).toEqual([email]);
    await pg.query(`update public.conversations set unread = true where id = $1`, [sms]);
  });

  it('filters by status, hiding closed from the default view', async () => {
    await setConversationStatus(both.owner.db as never, { organizationId: both.organizationId, conversationId: sms, status: 'closed' });
    expect(await ids(both, both.owner)).toEqual([email]);
    expect(await ids(both, both.owner, { status: 'closed' })).toEqual([sms]);
    expect(await ids(both, both.owner, { status: 'open' })).toEqual([email]);
    expect((await ids(both, both.owner, { status: 'any' })).sort()).toEqual([email, sms].sort());
    await setConversationStatus(both.owner.db as never, { organizationId: both.organizationId, conversationId: sms, status: 'waiting' });
    expect(await ids(both, both.owner, { status: 'waiting' })).toEqual([sms]);
    expect((await ids(both, both.owner)).sort()).toEqual([email, sms].sort());
  });

  it('filters by who is handling it', async () => {
    expect((await ids(both, both.owner, { view: 'unassigned' })).sort()).toEqual([email, sms].sort());
    await assignConversation(both.owner.db as never, { organizationId: both.organizationId, conversationId: email, membershipId: both.sarah.membershipId });
    expect(await ids(both, both.owner, { view: 'unassigned' })).toEqual([sms]);
    expect(await ids(both, both.sarah, { view: 'mine' })).toEqual([email]);
    expect(await ids(both, both.owner, { view: 'mine' })).toEqual([]);

    const counts = await getInboxCounts(both.sarah.db as never, { organizationId: both.organizationId, membershipId: both.sarah.membershipId });
    expect(counts).toMatchObject({ mine: 1, unassigned: 1 });
    await releaseConversation(both.owner.db as never, { organizationId: both.organizationId, conversationId: email });
  });

  it('orders by last activity and not by creation', async () => {
    await pg.query(`update public.conversations set last_message_at = now() + interval '1 minute' where id = $1`, [sms]);
    expect((await ids(both, both.owner))[0]).toBe(sms);
  });

  it('pages without skipping or repeating a row, including rows with identical activity times', async () => {
    const tenant = await newTenant('ib-page', freshNumber());
    const made: string[] = [];
    for (let i = 0; i < 7; i += 1) made.push(await inboundSms(tenant, `+1416555090${i}`));
    // Five of the seven share one instant, so only the id can order them.
    await pg.query(`update public.conversations set last_message_at = '2030-01-01T00:00:00Z' where id = any($1::uuid[])`, [made.slice(0, 5)]);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await inbox(tenant, tenant.owner, {}, { cursor, limit: 3 });
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(new Set(seen)).toEqual(new Set(made));
  }, 60_000);

  it('never shows another business a conversation, whatever filter or organization it names', async () => {
    for (const filter of [{}, { channel: 'sms' as const }, { view: 'unread' as const }, { status: 'any' as const }]) {
      expect((await inbox(both, other.owner, filter)).items).toEqual([]);
      const named = await listInbox(other.owner.db as never, { organizationId: both.organizationId, filter });
      expect(named.items).toEqual([]);
    }
  });
});

describe('a conversation follows its messages, conservatively', () => {
  it('is reopened when they write again, and waiting once an answer has actually gone out', async () => {
    const id = await inboundSms(mine, '+14165550811');
    await setConversationStatus(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, status: 'closed' });

    await inboundSms(mine, '+14165550811', 'Hello again');
    expect((await statusOf(id)).status).toBe('open');

    // Queued is not sent: nothing has left, so nobody is waiting on them yet.
    const queued = await pg.query(
      `insert into public.messages (organization_id, conversation_id, direction, status, body, requested_transport, created_by) values ($1, $2, 'outbound', 'queued', 'Reply', 'sms', $3) returning id`,
      [mine.organizationId, id, mine.owner.userId]);
    expect((await statusOf(id)).status).toBe('open');
    await pg.query(`update public.messages set status = 'sent' where id = $1`, [queued.rows[0].id]);
    expect((await statusOf(id)).status).toBe('waiting');

    expect(await actions(id)).toEqual(expect.arrayContaining(['conversation.closed', 'conversation.opened', 'conversation.waiting']));
  });

  it('leaves a closed conversation closed when a reply goes out, and a delivery callback never changes its state or its unread flag', async () => {
    const id = await inboundSms(mine, '+14165550812');
    await pg.query(`update public.conversations set unread = false where id = $1`, [id]);
    await setConversationStatus(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, status: 'closed' });
    const out = await pg.query(
      `insert into public.messages (organization_id, conversation_id, direction, status, body, requested_transport, external_id, created_by) values ($1, $2, 'outbound', 'queued', 'Bye', 'sms', $3, $4) returning id`,
      [mine.organizationId, id, `SM${randomUUID()}`, mine.owner.userId]);
    await pg.query(`update public.messages set status = 'sent' where id = $1`, [out.rows[0].id]);
    expect(await statusOf(id)).toMatchObject({ status: 'closed', unread: false });

    const externalId = (await pg.query(`select external_id from public.messages where id = $1`, [out.rows[0].id])).rows[0].external_id;
    await asRole('sms_webhook', `select public.record_message_status($1, 'delivered')`, [externalId]);
    expect(await statusOf(id)).toMatchObject({ status: 'closed', unread: false });
  });

  it('marks an inbound email unread and open exactly as an inbound text does', async () => {
    const id = await inboundEmail(mine, 'status@example.test');
    expect(await statusOf(id)).toMatchObject({ status: 'open', unread: true });
  });
});

describe('who changes a conversation', () => {
  it('lets a person who can handle conversations set the status, and refuses one who cannot and another business', async () => {
    const id = await inboundSms(mine, '+14165550821');
    await setConversationStatus(mine.sarah.db as never, { organizationId: mine.organizationId, conversationId: id, status: 'waiting' });
    expect((await statusOf(id)).status).toBe('waiting');

    await expect(setConversationStatus(mine.viewer.db as never, { organizationId: mine.organizationId, conversationId: id, status: 'closed' })).rejects.toMatchObject({ code: 'conversation.forbidden' });
    await expect(setConversationStatus(other.owner.db as never, { organizationId: mine.organizationId, conversationId: id, status: 'closed' })).rejects.toMatchObject({ code: 'conversation.forbidden' });
    await expect(setConversationStatus(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, status: 'bogus' as never })).rejects.toMatchObject({ code: 'conversation.invalid' });
  });

  it('cannot be written around: no signed-in role can set status, assignee or customer on the table', async () => {
    const id = await inboundSms(mine, '+14165550822');
    for (const patch of [{ status: 'closed' }, { assignee_membership_id: mine.sarah.membershipId }, { customer_id: null }]) {
      const result = await mine.owner.db.from('conversations').update(patch).eq('id', id);
      expect(result.error, JSON.stringify(patch)).not.toBeNull();
    }
  });
});

describe('assignment', () => {
  it('claims an unassigned conversation, and a second claim finds it taken', async () => {
    const id = await inboundSms(mine, '+14165550831');
    expect(await claimConversation(mine.sarah.db as never, { organizationId: mine.organizationId, conversationId: id })).toBe(true);
    expect(await claimConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id })).toBe(false);
    expect((await statusOf(id)).assignee_membership_id).toBe(mine.sarah.membershipId);
  });

  it('lets exactly one of several simultaneous claims win', async () => {
    const id = await inboundSms(mine, '+14165550832');
    const results = await Promise.all(
      [mine.owner, mine.sarah, mine.owner, mine.sarah].map((who) => claimConversation(who.db as never, { organizationId: mine.organizationId, conversationId: id })),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const claims = (await actions(id)).filter((a) => a === 'conversation.assigned');
    expect(claims).toHaveLength(1);
  });

  it('assigns, reassigns and releases, keeping one current assignee and the whole history', async () => {
    const id = await inboundEmail(mine, 'assign@example.test');
    await assignConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: mine.sarah.membershipId });
    await assignConversation(mine.sarah.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: mine.owner.membershipId });
    expect((await statusOf(id)).assignee_membership_id).toBe(mine.owner.membershipId);
    await releaseConversation(mine.sarah.db as never, { organizationId: mine.organizationId, conversationId: id });
    expect((await statusOf(id)).assignee_membership_id).toBeNull();

    expect(await actions(id)).toEqual(expect.arrayContaining(['conversation.assigned', 'conversation.reassigned', 'conversation.released']));
    const detail = await getConversationDetail(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id });
    expect(detail!.activity.map((a) => a.text)).toEqual(['Assigned to Sarah Handler', expect.stringMatching(/^Reassigned from Sarah Handler to /), expect.stringMatching(/^Released by /)]);
  });

  it('refuses a person who cannot handle conversations, another business’s member, and an assigner without authority', async () => {
    const id = await inboundSms(mine, '+14165550833');
    await expect(assignConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: mine.viewer.membershipId })).rejects.toMatchObject({ code: 'conversation.invalid' });
    await expect(assignConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: other.owner.membershipId })).rejects.toMatchObject({ code: 'conversation.invalid' });
    await expect(assignConversation(other.owner.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: other.owner.membershipId })).rejects.toMatchObject({ code: 'conversation.forbidden' });
    await expect(assignConversation(mine.viewer.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: mine.sarah.membershipId })).rejects.toMatchObject({ code: 'conversation.forbidden' });
    expect((await statusOf(id)).assignee_membership_id).toBeNull();
  });

  it('offers only members who can handle conversations', async () => {
    const names = (await listAssignableMembers(mine.owner.db as never, { organizationId: mine.organizationId })).map((m) => m.name);
    expect(names).toContain('Sarah Handler');
    expect(names).not.toContain('Vic Viewer');
  });

  it('is independent of the customer: assigning a conversation changes nothing about the customer it is about', async () => {
    const customerId = await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Acme Plumbing', email: `acme-${randomUUID().slice(0, 6)}@example.test`, phone: '+14165550841' });
    const id = await inboundSms(mine, '+14165550841');
    expect((await statusOf(id)).customer_id).toBe(customerId);

    const before = (await pg.query(`select * from public.customers where id = $1`, [customerId])).rows[0];
    await assignConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: mine.sarah.membershipId });
    await claimConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id });
    await releaseConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id });
    expect((await pg.query(`select * from public.customers where id = $1`, [customerId])).rows[0]).toEqual(before);
  });

  it('forgets a member who leaves without losing the conversation', async () => {
    const id = await inboundSms(mine, '+14165550834');
    await assignConversation(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, membershipId: mine.sarah.membershipId });
    const sarahMembership = mine.sarah.membershipId;
    expect((await statusOf(id)).assignee_membership_id).toBe(sarahMembership);
    // (Removing a membership is the Team screen's act; the foreign key is what keeps the conversation.)
    const fk = await pg.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'conversations_assignee_fk'`);
    expect(fk.rows[0].def).toMatch(/ON DELETE SET NULL \(assignee_membership_id\)/);
  });
});

describe('contact points and customers', () => {
  const normalize = async (fn: 'normalize_phone' | 'normalize_email', value: string | null) =>
    (await pg.query(`select app.${fn}($1) as v`, [value])).rows[0].v as string | null;

  it('normalizes a phone number to E.164 only when the country is unambiguous', async () => {
    expect(await normalize('normalize_phone', '+1 (416) 555-0142')).toBe('+14165550142');
    expect(await normalize('normalize_phone', '+44 20 7946 0958')).toBe('+442079460958');
    expect(await normalize('normalize_phone', '0044 20 7946 0958')).toBe('+442079460958');
    // No country code: it does not say which country, so it is not guessed.
    expect(await normalize('normalize_phone', '(416) 555-0142')).toBeNull();
    expect(await normalize('normalize_phone', '555-0142')).toBeNull();
    expect(await normalize('normalize_phone', '+0123')).toBeNull();
    expect(await normalize('normalize_phone', null)).toBeNull();
  });

  it('normalizes an email by trimming and lowercasing and nothing cleverer', async () => {
    expect(await normalize('normalize_email', '  Kim.Smith+Quotes@Example.TEST ')).toBe('kim.smith+quotes@example.test');
    expect(await normalize('normalize_email', '   ')).toBeNull();
  });

  it('resolves a known text sender and a known email sender to the right customer, and an unknown one to nobody', async () => {
    const phoneCustomer = await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Phone Pat', phone: '+1 416-555-0851' });
    const emailCustomer = await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Email Eve', email: `Eve.${randomUUID().slice(0, 6)}@Example.test` });
    const eveAddress = (await pg.query(`select email from public.customers where id = $1`, [emailCustomer])).rows[0].email as string;
    const before = Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count);

    expect((await statusOf(await inboundSms(mine, '+14165550851'))).customer_id).toBe(phoneCustomer);
    expect((await statusOf(await inboundEmail(mine, eveAddress.toUpperCase()))).customer_id).toBe(emailCustomer);
    const strangerSms = await inboundSms(mine, '+14165550852');
    const strangerEmail = await inboundEmail(mine, 'nobody-known@example.test');
    expect((await statusOf(strangerSms)).customer_id).toBeNull();
    expect((await statusOf(strangerEmail)).customer_id).toBeNull();

    // Nothing was created on anyone's behalf.
    expect(Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count)).toBe(before);
    const detail = await getConversationDetail(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: strangerSms });
    expect(detail!.resolution).toEqual({ state: 'unresolved' });
  });

  it('does not guess between two customers who share a number, and offers both', async () => {
    await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Twin One', phone: '+14165550861' });
    await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Twin Two', phone: '+1 (416) 555-0861' });
    const id = await inboundSms(mine, '+14165550861');
    expect((await statusOf(id)).customer_id).toBeNull();

    const detail = await getConversationDetail(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id });
    expect(detail!.resolution.state).toBe('ambiguous');
    expect((detail!.resolution as { candidates: { name: string }[] }).candidates.map((c) => c.name).sort()).toEqual(['Twin One', 'Twin Two']);
  });

  it('ignores the same contact point in another business, in both directions', async () => {
    await createCustomer(other.owner.db as never, { organizationId: other.organizationId, name: 'Other Org Olive', phone: '+14165550871', email: `olive-${randomUUID().slice(0, 6)}@example.test` });
    const id = await inboundSms(mine, '+14165550871');
    expect((await statusOf(id)).customer_id).toBeNull();
    expect((await getConversationDetail(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id }))!.resolution).toEqual({ state: 'unresolved' });
  });

  it('suggests, but does not link, a customer who was added after the conversation began', async () => {
    const id = await inboundSms(mine, '+14165550881');
    await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Late Larry', phone: '+14165550881' });
    expect((await statusOf(id)).customer_id).toBeNull();
    const detail = await getConversationDetail(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id });
    expect(detail!.resolution).toMatchObject({ state: 'suggested', candidates: [{ name: 'Late Larry' }] });
  });

  it('links a conversation to a customer of this business on request, shows them, and can unlink — without touching the customer', async () => {
    const customerId = await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Linked Lena', phone: '+14165550891' });
    const before = (await pg.query(`select * from public.customers where id = $1`, [customerId])).rows[0];
    const id = await inboundSms(mine, '+14165550899');

    await linkConversationCustomer(mine.sarah.db as never, { organizationId: mine.organizationId, conversationId: id, customerId });
    const detail = await getConversationDetail(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id });
    expect(detail!.resolution).toMatchObject({ state: 'resolved', customer: { id: customerId, name: 'Linked Lena' } });
    expect((await inbox(mine, mine.owner)).items.find((i) => i.id === id)).toMatchObject({ title: 'Linked Lena', customer: { id: customerId } });
    // The number that wrote in was not added to the customer.
    expect((await pg.query(`select * from public.customers where id = $1`, [customerId])).rows[0]).toEqual(before);

    await linkConversationCustomer(mine.sarah.db as never, { organizationId: mine.organizationId, conversationId: id, customerId: null });
    expect((await statusOf(id)).customer_id).toBeNull();
    expect(await actions(id)).toEqual(expect.arrayContaining(['conversation.customer_linked', 'conversation.customer_unlinked']));
  });

  it('refuses to link to another business’s customer, and a caller who cannot handle conversations', async () => {
    const theirs = await createCustomer(other.owner.db as never, { organizationId: other.organizationId, name: 'Theirs', phone: '+14165550895' });
    const id = await inboundSms(mine, '+14165550896');
    await expect(linkConversationCustomer(mine.owner.db as never, { organizationId: mine.organizationId, conversationId: id, customerId: theirs })).rejects.toMatchObject({ code: 'conversation.forbidden' });
    await expect(linkConversationCustomer(other.owner.db as never, { organizationId: other.organizationId, conversationId: id, customerId: theirs })).rejects.toMatchObject({ code: 'conversation.forbidden' });
    const mineCustomer = await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Mine', phone: '+14165550897' });
    await expect(linkConversationCustomer(mine.viewer.db as never, { organizationId: mine.organizationId, conversationId: id, customerId: mineCustomer })).rejects.toMatchObject({ code: 'conversation.forbidden' });
    expect((await statusOf(id)).customer_id).toBeNull();
  });

  it('creates a customer from a conversation only when a person asks, seeded with the contact point, and links it', async () => {
    const id = await inboundEmail(mine, `new-${randomUUID().slice(0, 6)}@example.test`);
    const before = Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count);

    const customerId = await createCustomerFromConversation(mine.sarah.db as never, { organizationId: mine.organizationId, conversationId: id, name: 'Brand New Ben' });
    const row = (await pg.query(`select name, email from public.customers where id = $1`, [customerId])).rows[0];
    expect(row.name).toBe('Brand New Ben');
    expect(row.email).toBe((await pg.query(`select external_email from public.conversations where id = $1`, [id])).rows[0].external_email);
    expect((await statusOf(id)).customer_id).toBe(customerId);
    expect(Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count)).toBe(before + 1);
  });

  it('keeps the conversation and its messages when its customer is deleted', async () => {
    const customerId = await createCustomer(mine.owner.db as never, { organizationId: mine.organizationId, name: 'Soon Gone', phone: '+14165550898' });
    const id = await inboundSms(mine, '+14165550898');
    expect((await statusOf(id)).customer_id).toBe(customerId);

    await pg.query(`delete from public.customers where id = $1`, [customerId]);
    expect((await statusOf(id)).customer_id).toBeNull();
    expect(Number((await pg.query(`select count(*) from public.messages where conversation_id = $1`, [id])).rows[0].count)).toBeGreaterThan(0);
  });
});
