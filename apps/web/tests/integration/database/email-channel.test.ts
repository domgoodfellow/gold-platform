import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmailIdentity } from '@/lib/domain/email/identities';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Email as a channel of the one Message, against real Postgres and real RLS.
 *
 * The provider is never called: what is proved here is every decision the database makes about an
 * email — who may queue one and from where, what a provider's answer may and may not do to its
 * status, how an inbound message finds its conversation, and what no signed-in caller can write.
 * Machine roles are exercised the way `apps/api` wears them (`set local role`), which is the
 * boundary under test.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  domain: string;
  domainResourceId: string;
  identityId: string;
  address: string;
};

let pg: Client;
let mine: Tenant;
let other: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });

  const domain = `${label}-${randomUUID().slice(0, 6)}.example.test`;
  const named = await db.rpc('record_organization_email_domain', { p_organization_id: organizationId, p_domain: domain });
  if (named.error) throw named.error;
  const address = `hello@${domain}`;
  const identity = await createEmailIdentity(db as never, {
    organizationId, address, displayName: 'Hello', sendingDomainResourceId: named.data as string,
  });
  return { db, userId: created.data.user.id, organizationId, domain, domainResourceId: named.data as string, identityId: identity.id, address };
}

/** Runs a statement as a machine role for one transaction, the way the runtime does. */
async function asRole<T>(role: string, sql: string, params: unknown[] = []): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query(`set local role ${role}`);
    const result = await pg.query(sql, params);
    await pg.query('commit');
    return result.rows as T;
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

async function domainIs(tenant: Tenant, status: 'pending' | 'active' | 'failed') {
  await asRole('provider_operator', `select public.record_email_domain_provisioning($1, $2, $3)`, [tenant.organizationId, tenant.domainResourceId, status]);
}

const queue = (tenant: Tenant, args: Partial<{ identity: string | null; to: string | null; subject: string; text: string; html: string | null; conversation: string | null; key: string; customer: string | null; attachments: unknown[] }> = {}) =>
  tenant.db.rpc('queue_outbound_email', {
    p_organization_id: tenant.organizationId,
    p_email_identity_id: args.identity === undefined ? tenant.identityId : args.identity,
    p_to: args.to === undefined ? 'customer@example.test' : args.to,
    p_subject: args.subject ?? 'Your quote',
    p_text: args.text ?? 'Here is your quote.',
    p_html: args.html ?? null,
    p_conversation_id: args.conversation ?? null,
    p_idempotency_key: args.key ?? randomUUID(),
    p_customer_id: args.customer ?? null,
    p_attachments: args.attachments ?? [],
  });

const messageRow = async (id: string) =>
  (await pg.query(`select status, external_id, failure_reason, transport from public.messages where id = $1`, [id])).rows[0];
const usageCount = async (tenant: Tenant, messageId: string) =>
  Number((await pg.query(`select count(*) from public.usage_events where organization_id = $1 and meter_id = 'email_send' and reference = $2`, [tenant.organizationId, `email:${messageId}`])).rows[0].count);

beforeAll(async () => {
  pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  [mine, other] = await Promise.all([newTenant('em-a'), newTenant('em-b')]);
  await domainIs(mine, 'active');
  await domainIs(other, 'active');
}, 90_000);

afterAll(async () => {
  await pg.end();
});

describe('queueing an outbound email (the command)', () => {
  it('creates a queued email message, its conversation and its details, deciding the sender itself', async () => {
    const { data: id, error } = await queue(mine);
    expect(error).toBeNull();

    expect(await messageRow(id as string)).toMatchObject({ status: 'queued', transport: null });
    const detail = (await pg.query(`select subject, from_address, to_addresses from public.email_message_details where message_id = $1`, [id])).rows[0];
    expect(detail).toEqual({ subject: 'Your quote', from_address: mine.address, to_addresses: ['customer@example.test'] });

    const conv = (await pg.query(
      `select c.channel, c.external_email, c.email_identity_id, c.phone_number_id, c.subject from public.conversations c join public.messages m on m.conversation_id = c.id where m.id = $1`, [id])).rows[0];
    expect(conv).toEqual({ channel: 'email', external_email: 'customer@example.test', email_identity_id: mine.identityId, phone_number_id: null, subject: 'Your quote' });
  });

  it('is idempotent: the same key is the same message, however many times it is asked', async () => {
    const key = randomUUID();
    const a = await queue(mine, { key });
    const b = await queue(mine, { key, subject: 'A different subject entirely' });
    expect(b.data).toBe(a.data);
    expect(Number((await pg.query(`select count(*) from public.messages where organization_id = $1 and idempotency_key = $2`, [mine.organizationId, key])).rows[0].count)).toBe(1);
  });

  it('refuses another business’s address, and a nonexistent one, as the same thing', async () => {
    expect((await queue(mine, { identity: other.identityId })).error?.code).toBe('42501');
    expect((await queue(mine, { identity: randomUUID() })).error?.code).toBe('42501');
  });

  it('refuses an address that cannot send, and one whose domain is not ready', async () => {
    const noSend = await createEmailIdentity(mine.db as never, {
      organizationId: mine.organizationId, address: `quiet@${mine.domain}`, sendingDomainResourceId: mine.domainResourceId,
    });
    await mine.db.from('email_identities').update({ can_send: false }).eq('id', noSend.id).select();
    // A receive-only identity needs the receive flag to be a valid identity at all.
    await mine.db.from('email_identities').update({ can_receive: true, can_send: false }).eq('id', noSend.id);
    expect((await queue(mine, { identity: noSend.id })).error?.code).toBe('55000');

    await domainIs(mine, 'pending');
    expect((await queue(mine)).error?.code).toBe('55000');
    await domainIs(mine, 'active');
  });

  it('refuses a recipient that is not an address, a missing subject, and an empty email', async () => {
    expect((await queue(mine, { to: 'not-an-address' })).error?.code).toBe('22023');
    expect((await queue(mine, { subject: '   ' })).error?.code).toBe('22023');
    expect((await queue(mine, { text: '  ', html: null })).error?.code).toBe('22023');
    expect((await queue(mine, { subject: 'line\r\nBcc: someone@example.test' })).error?.code).toBe('22023');
  });

  it('refuses a caller without message.send', async () => {
    const outsider = await mine.db.rpc('queue_outbound_email', {
      p_organization_id: other.organizationId, p_email_identity_id: other.identityId, p_to: 'x@example.test', p_subject: 's', p_text: 't',
      p_html: null, p_conversation_id: null, p_idempotency_key: randomUUID(), p_customer_id: null, p_attachments: [],
    });
    expect(outsider.error?.code).toBe('42501');
  });

  it('associates a known customer by address only when exactly one has it, and never creates one', async () => {
    const before = Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count);
    const customer = await pg.query(
      `insert into public.customers (organization_id, name, email, created_by) values ($1, 'Known Kim', 'kim@example.test', $2) returning id`,
      [mine.organizationId, mine.userId]);
    const { data: id } = await queue(mine, { to: 'kim@example.test' });
    const row = (await pg.query(`select c.customer_id from public.conversations c join public.messages m on m.conversation_id = c.id where m.id = $1`, [id])).rows[0];
    expect(row.customer_id).toBe(customer.rows[0].id);

    await queue(mine, { to: 'stranger@example.test' });
    const after = Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count);
    expect(after).toBe(before + 1);
  });

  it('replies inside the conversation, fixing the sender and the recipient itself', async () => {
    const first = await queue(mine, { to: 'reply@example.test', subject: 'Original' });
    const conversation = (await pg.query(`select conversation_id from public.messages where id = $1`, [first.data])).rows[0].conversation_id;

    const reply = await queue(mine, { identity: null, to: null, subject: '', conversation, text: 'Following up.' });
    expect(reply.error).toBeNull();
    const detail = (await pg.query(`select subject, to_addresses, from_address from public.email_message_details where message_id = $1`, [reply.data])).rows[0];
    expect(detail).toEqual({ subject: 'Re: Original', to_addresses: ['reply@example.test'], from_address: mine.address });

    // A reply cannot name a different recipient or a different address.
    expect((await queue(mine, { conversation, to: 'someone-else@example.test' })).error?.code).toBe('22023');
    const otherIdentity = await createEmailIdentity(mine.db as never, {
      organizationId: mine.organizationId, address: `second@${mine.domain}`, sendingDomainResourceId: mine.domainResourceId,
    });
    expect((await queue(mine, { conversation, identity: otherIdentity.id, to: null })).error?.code).toBe('22023');

    // And another business cannot reply into it.
    expect((await queue(other, { conversation, identity: null, to: null })).error?.code).toBe('42501');
  });
});

describe('what a signed-in caller can no longer write', () => {
  it('cannot insert an email message directly, mark one delivered, or reach the provider doors', async () => {
    const { data: id } = await queue(mine);
    const conv = (await pg.query(`select conversation_id from public.messages where id = $1`, [id])).rows[0].conversation_id;

    const direct = await mine.db.from('messages').insert({
      organization_id: mine.organizationId, conversation_id: conv, direction: 'outbound', body: 'forged', requested_transport: 'email',
      status: 'delivered', external_id: 'forged-id', created_by: mine.userId,
    });
    expect(direct.error).not.toBeNull();

    const update = await mine.db.from('messages').update({ status: 'delivered' }).eq('id', id as string).select();
    expect(update.data ?? []).toEqual([]);
    expect((await messageRow(id as string)).status).toBe('queued');

    for (const [fn, args] of [
      ['claim_email_for_send', { p_organization_id: mine.organizationId, p_message_id: id }],
      ['record_email_send_result', { p_organization_id: mine.organizationId, p_message_id: id, p_outcome: 'accepted' }],
      ['record_email_event', { p_provider_message_id: 'x', p_event_type: 'delivered', p_provider_event_id: 'e', p_detail: null, p_payload: {} }],
    ] as const) {
      const { error } = await mine.db.rpc(fn, args as never);
      expect(error, fn).not.toBeNull();
    }
  });

  it('cannot read another business’s email details, events or attachments', async () => {
    const { data: id } = await queue(mine);
    for (const table of ['email_message_details', 'message_events', 'message_attachments']) {
      const read = await other.db.from(table).select('*').eq('organization_id', mine.organizationId);
      expect(read.data ?? [], table).toEqual([]);
    }
    expect(id).toBeTruthy();
  });
});

describe('what the provider answered about a send', () => {
  it('claims a queued message once, bills one email when the provider accepts it, and records the confirmed Message-ID', async () => {
    const { data: id } = await queue(mine);
    expect((await asRole<{ claim_email_for_send: boolean }[]>('provider_operator', `select public.claim_email_for_send($1, $2)`, [mine.organizationId, id]))[0].claim_email_for_send).toBe(true);
    expect((await asRole<{ claim_email_for_send: boolean }[]>('provider_operator', `select public.claim_email_for_send($1, $2)`, [mine.organizationId, id]))[0].claim_email_for_send).toBe(false);
    expect((await messageRow(id as string)).status).toBe('sending');

    const accept = () => asRole('provider_operator', `select public.record_email_send_result($1, $2, 'accepted', $3, null, $4)`, [mine.organizationId, id, `re_${id}`, 'confirmed-1@mail.example.test']);
    await accept();
    await accept();

    expect(await messageRow(id as string)).toMatchObject({ status: 'sent', external_id: `re_${id}`, transport: 'email' });
    expect((await pg.query(`select rfc_message_id from public.email_message_details where message_id = $1`, [id])).rows[0].rfc_message_id).toBe('<confirmed-1@mail.example.test>');
    expect(await usageCount(mine, id as string)).toBe(1);
    expect(Number((await pg.query(`select count(*) from public.message_events where message_id = $1 and event_type = 'accepted'`, [id])).rows[0].count)).toBe(1);
  });

  it('records a provider refusal as rejected with its reason, and bills nothing', async () => {
    const { data: id } = await queue(mine);
    await asRole('provider_operator', `select public.claim_email_for_send($1, $2)`, [mine.organizationId, id]);
    await asRole('provider_operator', `select public.record_email_send_result($1, $2, 'rejected', null, 'The recipient address was refused')`, [mine.organizationId, id]);

    expect(await messageRow(id as string)).toMatchObject({ status: 'rejected', failure_reason: 'The recipient address was refused' });
    expect(await usageCount(mine, id as string)).toBe(0);
  });

  it('puts a transiently failed attempt back in the queue so the same message can be tried again', async () => {
    const { data: id } = await queue(mine);
    await asRole('provider_operator', `select public.claim_email_for_send($1, $2)`, [mine.organizationId, id]);
    await asRole('provider_operator', `select public.record_email_send_result($1, $2, 'retry', null, 'provider unreachable')`, [mine.organizationId, id]);
    expect((await messageRow(id as string)).status).toBe('queued');
    expect((await asRole<{ claim_email_for_send: boolean }[]>('provider_operator', `select public.claim_email_for_send($1, $2)`, [mine.organizationId, id]))[0].claim_email_for_send).toBe(true);
  });
});

describe('delivery events', () => {
  const eventAs = (providerId: string, type: string, eventId: string, at?: string) =>
    asRole<{ record_email_event: string | null }[]>(
      'tenant_email_webhook', `select public.record_email_event($1, $2, $3, null, '{}'::jsonb, $4)`, [providerId, type, eventId, at ?? null]);

  async function sentMessage(): Promise<{ id: string; providerId: string }> {
    const { data: id } = await queue(mine);
    const providerId = `re_${randomUUID()}`;
    await asRole('provider_operator', `select public.claim_email_for_send($1, $2)`, [mine.organizationId, id]);
    await asRole('provider_operator', `select public.record_email_send_result($1, $2, 'accepted', $3)`, [mine.organizationId, id, providerId]);
    return { id: id as string, providerId };
  }

  it('moves forward only, keeps every event, and survives a duplicate, a late and an unrelated callback', async () => {
    const { id, providerId } = await sentMessage();

    expect((await eventAs(providerId, 'delivered', 'evt-1'))[0].record_email_event).not.toBeNull();
    expect((await messageRow(id)).status).toBe('delivered');

    // A retried callback is the same fact.
    expect((await eventAs(providerId, 'delivered', 'evt-1'))[0].record_email_event).toBeNull();
    // A late `sent` cannot make a delivered message merely sent again — but it is still history.
    await eventAs(providerId, 'sent', 'evt-0', '2020-01-01T00:00:00Z');
    expect((await messageRow(id)).status).toBe('delivered');
    // Engagement is history, never status.
    await eventAs(providerId, 'opened', 'evt-2');
    expect((await messageRow(id)).status).toBe('delivered');

    const history = await pg.query(`select event_type from public.message_events where message_id = $1 order by occurred_at`, [id]);
    expect(history.rows.map((r) => r.event_type)).toEqual(expect.arrayContaining(['queued', 'accepted', 'delivered', 'sent', 'opened']));
    expect(history.rows.filter((r) => r.event_type === 'delivered')).toHaveLength(1);
    expect(await usageCount(mine, id)).toBe(1);
  });

  it('lets a bounce outrank delivery and does not let a later delivery undo it', async () => {
    const { id, providerId } = await sentMessage();
    await eventAs(providerId, 'delivered', 'b-1');
    await eventAs(providerId, 'bounced', 'b-2');
    expect((await messageRow(id)).status).toBe('bounced');
    await eventAs(providerId, 'delivered', 'b-3');
    expect((await messageRow(id)).status).toBe('bounced');
  });

  it('ignores a callback about a message this platform never sent, and cannot be pointed at another business’s', async () => {
    expect((await eventAs(`re_${randomUUID()}`, 'delivered', 'u-1'))[0].record_email_event).toBeNull();
    // The organization is derived from the message the provider id belongs to: there is no argument for it.
    const fn = (await pg.query(`select pg_get_function_arguments(oid) as args from pg_proc where proname = 'record_email_event'`)).rows[0].args as string;
    expect(fn).not.toMatch(/organization/);
  });

  it('refuses an event type it does not know', async () => {
    await expect(eventAs('whatever', 'teleported', 'x-1')).rejects.toThrow(/unknown email event/);
  });
});

describe('inbound email', () => {
  const inbound = (args: Partial<{ to: string[]; from: string; emailId: string; rfc: string | null; inReplyTo: string | null; refs: string[]; subject: string; text: string; html: string | null; attachments: unknown[] }> = {}) =>
    asRole<{ record_inbound_email: { message_id: string; organization_id: string; attachments: { id: string }[]; duplicate: boolean } | null }[]>(
      'tenant_email_webhook',
      `select public.record_inbound_email($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), null, $11::jsonb)`,
      [args.to ?? [mine.address], args.from ?? 'Someone@Example.test', args.emailId ?? `in_${randomUUID()}`, `evt_${randomUUID()}`,
       args.rfc === undefined ? `<${randomUUID()}@mail.example.test>` : args.rfc, args.inReplyTo ?? null, args.refs ?? [],
       args.subject ?? 'Question about my quote', args.text ?? 'Hello, a question.', args.html ?? null, JSON.stringify(args.attachments ?? [])],
    ).then((rows) => rows[0].record_inbound_email);

  beforeAll(async () => {
    // The business states that mail for this address is pointed here.
    const { error } = await mine.db.from('email_identities').update({ can_receive: true }).eq('id', mine.identityId);
    if (error) throw error;
  });

  it('persists an inbound message in a new conversation, preserving an unknown sender without creating a customer', async () => {
    const before = Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count);
    const result = await inbound({ from: 'Brand-New@Example.test' });
    expect(result?.duplicate).toBe(false);
    expect(result?.organization_id).toBe(mine.organizationId);

    const row = (await pg.query(
      `select m.direction, m.status, m.transport, c.channel, c.external_email, c.customer_id, c.unread, d.from_address
         from public.messages m join public.conversations c on c.id = m.conversation_id join public.email_message_details d on d.message_id = m.id where m.id = $1`, [result!.message_id])).rows[0];
    expect(row).toEqual({ direction: 'inbound', status: 'delivered', transport: 'email', channel: 'email', external_email: 'brand-new@example.test', customer_id: null, unread: true, from_address: 'brand-new@example.test' });
    expect(Number((await pg.query(`select count(*) from public.customers where organization_id = $1`, [mine.organizationId])).rows[0].count)).toBe(before);
  });

  it('associates a known customer when exactly one has the address', async () => {
    const customer = await pg.query(
      `insert into public.customers (organization_id, name, email, created_by) values ($1, 'Known Kim', 'kim-inbound@example.test', $2) returning id`, [mine.organizationId, mine.userId]);
    const result = await inbound({ from: 'kim-inbound@example.test' });
    const row = (await pg.query(`select c.customer_id from public.conversations c join public.messages m on m.conversation_id = c.id where m.id = $1`, [result!.message_id])).rows[0];
    expect(row.customer_id).toBe(customer.rows[0].id);
  });

  it('records one message for a provider email delivered twice, and for the same Message-ID under two provider ids', async () => {
    const emailId = `in_${randomUUID()}`;
    const rfc = `<${randomUUID()}@mail.example.test>`;
    const first = await inbound({ emailId, rfc });
    const again = await inbound({ emailId, rfc });
    const reissued = await inbound({ rfc });
    expect(again?.duplicate).toBe(true);
    expect(again?.message_id).toBe(first?.message_id);
    expect(reissued?.duplicate).toBe(true);
    expect(reissued?.message_id).toBe(first?.message_id);
  });

  it('threads a reply by In-Reply-To to the outbound message the provider confirmed, and by References when the reply header is missing', async () => {
    const { data: out } = await queue(mine, { to: 'thread@example.test', subject: 'Quote 42' });
    await asRole('provider_operator', `select public.claim_email_for_send($1, $2)`, [mine.organizationId, out]);
    await asRole('provider_operator', `select public.record_email_send_result($1, $2, 'accepted', $3, null, $4)`, [mine.organizationId, out, `re_${out}`, 'sent-42@mail.example.test']);
    const conv = (await pg.query(`select conversation_id from public.messages where id = $1`, [out])).rows[0].conversation_id;

    const reply = await inbound({ from: 'thread@example.test', inReplyTo: '<sent-42@mail.example.test>', subject: 'Re: Quote 42' });
    expect((await pg.query(`select conversation_id from public.messages where id = $1`, [reply!.message_id])).rows[0].conversation_id).toBe(conv);

    const viaReferences = await inbound({ from: 'thread@example.test', inReplyTo: null, refs: ['<unrelated@x>', '<sent-42@mail.example.test>'], subject: 'Different subject' });
    expect((await pg.query(`select conversation_id from public.messages where id = $1`, [viaReferences!.message_id])).rows[0].conversation_id).toBe(conv);

    // A reply to the reply threads too, once the inbound's own Message-ID is recorded.
    const replyId = (await pg.query(`select rfc_message_id from public.email_message_details where message_id = $1`, [reply!.message_id])).rows[0].rfc_message_id as string;
    const deeper = await inbound({ from: 'thread@example.test', inReplyTo: replyId });
    expect((await pg.query(`select conversation_id from public.messages where id = $1`, [deeper!.message_id])).rows[0].conversation_id).toBe(conv);
  });

  it('does not thread on subject and sender alone, and starts a new conversation for an unknown thread', async () => {
    const { data: out } = await queue(mine, { to: 'same@example.test', subject: 'Same subject' });
    const conv = (await pg.query(`select conversation_id from public.messages where id = $1`, [out])).rows[0].conversation_id;
    const lookalike = await inbound({ from: 'same@example.test', subject: 'Re: Same subject' });
    expect((await pg.query(`select conversation_id from public.messages where id = $1`, [lookalike!.message_id])).rows[0].conversation_id).not.toBe(conv);

    const unknown = await inbound({ from: 'same@example.test', inReplyTo: '<nobody-has-this@x>' });
    expect(unknown?.message_id).toBeTruthy();
  });

  it('never threads across businesses, even when the Message-ID is identical', async () => {
    const { data: out } = await queue(other, { to: 'cross@example.test', subject: 'Theirs' });
    await asRole('provider_operator', `select public.claim_email_for_send($1, $2)`, [other.organizationId, out]);
    await asRole('provider_operator', `select public.record_email_send_result($1, $2, 'accepted', $3, null, $4)`, [other.organizationId, out, `re_${out}`, 'shared-id@mail.example.test']);
    const theirConv = (await pg.query(`select conversation_id from public.messages where id = $1`, [out])).rows[0].conversation_id;

    const mineReply = await inbound({ from: 'cross@example.test', inReplyTo: '<shared-id@mail.example.test>' });
    const conv = (await pg.query(`select conversation_id from public.messages where id = $1`, [mineReply!.message_id])).rows[0].conversation_id;
    expect(conv).not.toBe(theirConv);
    expect((await pg.query(`select organization_id from public.conversations where id = $1`, [conv])).rows[0].organization_id).toBe(mine.organizationId);
  });

  it('accepts mail only for an active, receiving address on a verified domain — and derives the business from it', async () => {
    expect(await inbound({ to: ['nobody@unknown.example.test'] })).toBeNull();
    // `other`'s address does not receive (they never said so).
    expect(await inbound({ to: [other.address] })).toBeNull();

    await domainIs(mine, 'failed');
    expect(await inbound()).toBeNull();
    await domainIs(mine, 'active');

    // A hostile payload cannot name its business: the function has no argument for one.
    const args = (await pg.query(`select pg_get_function_arguments(oid) as args from pg_proc where proname = 'record_inbound_email'`)).rows[0].args as string;
    expect(args).not.toMatch(/organization/);
  });

  it('refuses an inbound call from a signed-in session', async () => {
    const { error } = await mine.db.rpc('record_inbound_email', {
      p_to_addresses: [mine.address], p_from_address: 'x@example.test', p_provider_email_id: 'forged', p_provider_event_id: 'forged',
      p_rfc_message_id: null, p_in_reply_to: null, p_references: [], p_subject: 's', p_text: 't', p_html: null, p_received_at: null, p_authentication: null, p_attachments: [],
    });
    expect(error).not.toBeNull();
  });

  it('records attachment metadata as pending and keeps no provider link', async () => {
    const result = await inbound({ attachments: [{ id: 'att-1', filename: 'quote.pdf', content_type: 'application/pdf', size: 1234, content_disposition: 'attachment', download_url: 'https://provider.example/temporary' }] });
    const rows = (await pg.query(`select filename, storage_state, storage_path, provider_attachment_id from public.message_attachments where message_id = $1`, [result!.message_id])).rows;
    expect(rows).toEqual([{ filename: 'quote.pdf', storage_state: 'pending', storage_path: null, provider_attachment_id: 'att-1' }]);
    const columns = (await pg.query(`select column_name from information_schema.columns where table_name = 'message_attachments'`)).rows.map((r) => r.column_name);
    expect(columns.join(' ')).not.toMatch(/url/);

    const attachmentId = result!.attachments[0].id;
    const stored = `${mine.organizationId}/inbound/${randomUUID()}/quote.pdf`;
    await asRole('tenant_email_webhook', `select public.record_inbound_attachment_stored($1, $2, 1234)`, [attachmentId, stored]);
    expect((await pg.query(`select storage_state, storage_path from public.message_attachments where id = $1`, [attachmentId])).rows[0]).toEqual({ storage_state: 'stored', storage_path: stored });

    // Another business's folder is refused.
    const second = await inbound({ attachments: [{ id: 'att-2', filename: 'x.txt', content_type: 'text/plain', size: 1 }] });
    await expect(asRole('tenant_email_webhook', `select public.record_inbound_attachment_stored($1, $2, 1)`, [second!.attachments[0].id, `${other.organizationId}/inbound/x/x.txt`])).rejects.toThrow(/no pending attachment/);
  });
});

describe('outbound attachments are this business’s own', () => {
  async function upload(tenant: Tenant, bytes = 'hello'): Promise<string> {
    const path = `${tenant.organizationId}/outbound/${randomUUID()}/note.txt`;
    const { error } = await tenant.db.storage.from('communications').upload(path, new Blob([bytes]), { contentType: 'text/plain' });
    if (error) throw error;
    return path;
  }

  it('attaches a file the business uploaded, and refuses a path outside its folder or one never uploaded', async () => {
    const path = await upload(mine);
    const ok = await queue(mine, { attachments: [{ storage_path: path, filename: 'note.txt', content_type: 'text/plain', size_bytes: 5 }] });
    expect(ok.error).toBeNull();
    const rows = (await pg.query(`select filename, storage_state from public.message_attachments where message_id = $1`, [ok.data])).rows;
    expect(rows).toEqual([{ filename: 'note.txt', storage_state: 'stored' }]);

    const theirs = await upload(other);
    expect((await queue(mine, { attachments: [{ storage_path: theirs, filename: 'n.txt', content_type: 'text/plain', size_bytes: 5 }] })).error?.code).toBe('42501');
    expect((await queue(mine, { attachments: [{ storage_path: `${mine.organizationId}/outbound/${randomUUID()}/ghost.txt`, filename: 'g.txt', content_type: 'text/plain', size_bytes: 5 }] })).error?.code).toBe('22023');
  });

  it('keeps a stored attachment unreadable to another business, by path or by id', async () => {
    const path = await upload(mine);
    await queue(mine, { attachments: [{ storage_path: path, filename: 'note.txt', content_type: 'text/plain', size_bytes: 5 }] });

    const download = await other.db.storage.from('communications').download(path);
    expect(download.error).not.toBeNull();
    expect((await other.db.from('message_attachments').select('id').eq('storage_path', path)).data ?? []).toEqual([]);
    expect((await other.db.storage.from('communications').upload(`${mine.organizationId}/outbound/${randomUUID()}/x.txt`, new Blob(['x']))).error).not.toBeNull();
  });

  it('refuses too many, too large, and an empty size', async () => {
    const path = await upload(mine);
    const one = { storage_path: path, filename: 'n.txt', content_type: 'text/plain', size_bytes: 5 };
    expect((await queue(mine, { attachments: Array.from({ length: 11 }, () => one) })).error?.code).toBe('54000');
    expect((await queue(mine, { attachments: [{ ...one, size_bytes: 10485761 }] })).error?.code).toBe('54000');
    expect((await queue(mine, { attachments: [{ ...one, size_bytes: 0 }] })).error?.code).toBe('54000');
  });
});
