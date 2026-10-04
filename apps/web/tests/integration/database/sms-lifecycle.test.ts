import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { beginProviderBinding, recordProviderResource } from '@/lib/domain/providers/bindings';
import { replyToConversation } from '@/lib/domain/reception/outbound';
import { sendSms } from '@/lib/domain/reception/messaging';
import { currentMembershipId, getConversationDetail, listInbox, setConversationStatus } from '@/lib/domain/reception/inbox';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * A text message's whole life, against real Postgres and real RLS: who may say what happened to it, what
 * the carrier's word does and does not change, and what a retried or late callback may not undo. The
 * carrier itself is replaced by a recorder — every decision above it is the real one.
 */

const carrier = vi.hoisted(() => ({
  calls: [] as { from: string; to: string; body: string }[],
  answer: { status: 'queued' } as { status: string },
  fail: false,
}));

vi.mock('@/lib/adapters/messaging', () => ({
  messagingCallbackBase: () => 'https://callbacks.example.test',
  messagingProvider: async () => ({
    sendMessage: async (input: { from: string; to: string; body: string }) => {
      carrier.calls.push(input);
      if (carrier.fail) throw new Error('messaging refused the send (400): {"code":21211,"message":"Invalid To number +1555"}');
      return { externalId: `SM${randomUUID().replace(/-/g, '')}`, status: carrier.answer.status };
    },
  }),
}));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PASSWORD = 'sms-lifecycle-pw';

type Tenant = { organizationId: string; db: SupabaseClient; userId: string; membershipId: string; numberId: string; e164: string; resourceId: string; secondNumberId: string };

let pg: Client;
let staff: SupabaseClient;
let mine: Tenant;
let other: Tenant;

const freshNumber = () => `+1416${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: 'XXX' });
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error) throw signedIn.error;

  await beginProviderBinding(staff, { organizationId, providerKey: 'twilio' });
  const number = async () => {
    const e164 = freshNumber();
    const resourceId = await recordProviderResource(staff, { organizationId, providerKey: 'twilio', resourceType: 'twilio_phone_number', externalId: `PN${randomUUID().replace(/-/g, '').slice(0, 32)}` });
    const synced = await staff.rpc('sync_phone_number', { p_organization_id: organizationId, p_provider_resource_id: resourceId, p_e164: e164 });
    if (synced.error) throw synced.error;
    return { id: synced.data as string, e164, resourceId };
  };
  const first = await number();
  const second = await number();
  return { organizationId, db, userId: created.data.user.id, membershipId: (await currentMembershipId(db as never, { organizationId }))!, numberId: first.id, e164: first.e164, resourceId: first.resourceId, secondNumberId: second.id };
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

const status = (sid: string, to: string, reason: string | null = null) =>
  asRole<{ record_message_status: string | null }>('sms_webhook', `select public.record_message_status($1, $2, $3)`, [sid, to, reason]).then((rows) => rows[0].record_message_status);
const inbound = (tenant: Tenant, from: string, body = 'Hello', sid = `SM${randomUUID()}`) =>
  asRole<{ record_inbound_message: string | null }>('sms_webhook', `select public.record_inbound_message($1, $2, $3, $4)`, [tenant.e164, from, sid, body]).then((rows) => rows[0].record_inbound_message);

const send = (tenant: Tenant, to = '+14165550142', extra: { numberId?: string; key?: string; body?: string } = {}) =>
  sendSms(tenant.db as never, { organizationId: tenant.organizationId, phoneNumberId: extra.numberId ?? tenant.numberId, toNumber: to, body: extra.body ?? 'Your appointment is tomorrow.', idempotencyKey: extra.key ?? randomUUID() });

const message = async (id: string) => (await pg.query(`select status, external_id, failure_reason, transport, sent_at, delivered_at, conversation_id from public.messages where id = $1`, [id])).rows[0];
const conversation = async (id: string) => (await pg.query(`select status, unread, last_message_at, customer_id from public.conversations where id = $1`, [id])).rows[0];
const usage = async (messageId: string) =>
  (await pg.query(`select quantity from public.usage_events where meter_id = 'sms_segment' and reference = $1`, [messageId])).rows.map((r) => Number(r.quantity));

beforeAll(async () => {
  pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  staff = await asPlatformStaff();
  [mine, other] = await Promise.all([newTenant('sl-a'), newTenant('sl-b')]);
}, 120_000);

afterAll(async () => {
  await pg.end();
});

beforeEach(() => {
  carrier.calls.length = 0;
  carrier.answer = { status: 'queued' };
  carrier.fail = false;
});

describe('nobody signed in can say what the carrier did', () => {
  const direct = (tenant: Tenant, conversationId: string, extra: Record<string, unknown>) =>
    tenant.db.from('messages').insert({ organization_id: tenant.organizationId, conversation_id: conversationId, direction: 'outbound', body: 'x', requested_transport: 'sms', created_by: tenant.userId, ...extra });

  async function conversationFor(tenant: Tenant) {
    const created = await tenant.db.from('conversations').insert({ organization_id: tenant.organizationId, phone_number_id: tenant.numberId, external_number: freshNumber() }).select('id').single();
    return created.data!.id as string;
  }

  it('creates a text only as queued, with none of the carrier’s columns filled in', async () => {
    const conv = await conversationFor(mine);
    expect((await direct(mine, conv, {})).error).toBeNull();
    for (const forged of [{ status: 'delivered' }, { status: 'sent' }, { external_id: 'SMforged' }, { failure_reason: 'x' }, { sent_at: new Date().toISOString() }, { delivered_at: new Date().toISOString() }, { transport: 'sms' }]) {
      expect((await direct(mine, conv, forged)).error, JSON.stringify(forged)).not.toBeNull();
    }
  });

  it('cannot change a text it sent: the table has no update path for a signed-in role', async () => {
    const sent = await send(mine);
    const attempt = await mine.db.from('messages').update({ status: 'delivered' }).eq('id', sent.id).select();
    expect(attempt.error).not.toBeNull();
    expect((await message(sent.id)).status).toBe('queued');
  });

  it('may report only what a send itself can answer, and only for its own waiting outbound text', async () => {
    carrier.answer = { status: 'queued' };
    const sent = await send(mine);
    const report = (tenant: Tenant, id: string, state: string, sid: string | null = null) =>
      tenant.db.rpc('record_sms_send_result', { p_organization_id: tenant.organizationId, p_message_id: id, p_status: state, p_external_id: sid as string, p_failure_reason: null as unknown as string });

    for (const forged of ['delivered', 'read', 'undelivered', 'bogus']) {
      expect((await report(mine, sent.id, forged)).error, forged).not.toBeNull();
    }
    expect((await report(other, sent.id, 'sent')).error).not.toBeNull();
    expect((await message(sent.id)).status).toBe('queued');

    // An inbound text is not one of ours to report on.
    const inboundId = (await inbound(mine, freshNumber()))!;
    expect((await report(mine, inboundId, 'failed')).error).not.toBeNull();

    // And once the carrier has taken it, a later report changes nothing.
    await status((await message(sent.id)).external_id, 'delivered');
    expect((await report(mine, sent.id, 'failed')).error).toBeNull();
    expect((await message(sent.id)).status).toBe('delivered');
  });

  it('never lets a signed-in session reach the carrier’s own doors', async () => {
    for (const [fn, args] of [
      ['record_message_status', { p_external_id: 'x', p_status: 'delivered', p_failure_reason: null }],
      ['record_inbound_message', { p_to_number: mine.e164, p_from_number: '+14165550199', p_external_id: 'x', p_body: 'hi' }],
      ['record_message_suppression', { p_to_number: mine.e164, p_external_number: '+14165550199', p_opted_out: true }],
    ] as const) {
      expect((await mine.db.rpc(fn, args as never)).error, fn).not.toBeNull();
    }
  });
});

describe('what a send does to the message and the conversation', () => {
  it('records the carrier taking it as queued with its id, bills nothing yet, and does not make the conversation wait', async () => {
    const sent = await send(mine, freshNumber());
    const row = await message(sent.id);
    expect(row).toMatchObject({ status: 'queued', transport: 'sms' });
    expect(row.external_id).toMatch(/^SM/);
    expect(await usage(sent.id)).toEqual([]);
    expect((await conversation(row.conversation_id)).status).toBe('open');
  });

  it('follows the carrier: sent bills once and makes the conversation wait, delivered is delivered, a repeat changes nothing', async () => {
    const sent = await send(mine, freshNumber());
    const { external_id: sid, conversation_id: conv } = await message(sent.id);

    expect(await status(sid, 'sending')).toBe(sent.id);
    expect((await conversation(conv)).status).toBe('open');
    await status(sid, 'sent');
    expect((await message(sent.id)).status).toBe('sent');
    expect((await conversation(conv)).status).toBe('waiting');
    expect(await usage(sent.id)).toEqual([1]);

    await status(sid, 'delivered');
    const delivered = await message(sent.id);
    expect(delivered.status).toBe('delivered');
    expect(delivered.delivered_at).not.toBeNull();

    // A retried callback is the same fact: nothing moves and nothing is billed again.
    await status(sid, 'delivered');
    await status(sid, 'sent');
    expect(await usage(sent.id)).toEqual([1]);
  });

  it('is not undone by a late callback, and a failure after delivery is still real', async () => {
    const sent = await send(mine);
    const sid = (await message(sent.id)).external_id;
    await status(sid, 'delivered');

    await status(sid, 'sent');
    await status(sid, 'sending');
    await status(sid, 'queued');
    expect((await message(sent.id)).status).toBe('delivered');

    await status(sid, 'undelivered', 'The phone could not be reached.');
    expect(await message(sent.id)).toMatchObject({ status: 'undelivered', failure_reason: 'The phone could not be reached.' });
    // And once it has failed, a later delivered does not resurrect it.
    await status(sid, 'delivered');
    expect((await message(sent.id)).status).toBe('undelivered');
  });

  it('bills a text the carrier took as already sent exactly once, however many callbacks follow', async () => {
    carrier.answer = { status: 'sent' };
    const sent = await send(mine);
    expect(await usage(sent.id)).toEqual([1]);
    const sid = (await message(sent.id)).external_id;
    await status(sid, 'sent');
    await status(sid, 'delivered');
    await status(sid, 'delivered');
    expect(await usage(sent.id)).toEqual([1]);
  });

  it('a text the carrier refuses is failed in words, is never billed, and does not make the conversation wait', async () => {
    carrier.fail = true;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(send(mine, '+14165550149')).rejects.toMatchObject({ code: 'messaging.send_failed' });
    consoleError.mockRestore();

    const row = (await pg.query(`select m.id, m.status, m.failure_reason, m.conversation_id from public.messages m join public.conversations c on c.id = m.conversation_id where c.organization_id = $1 and c.external_number = '+14165550149'`, [mine.organizationId])).rows[0];
    expect(row.status).toBe('failed');
    expect(row.failure_reason).toBe('The carrier could not accept this message.');
    expect(row.failure_reason).not.toMatch(/21211|messaging refused|\{/);
    expect(await usage(row.id)).toEqual([]);
    expect((await conversation(row.conversation_id)).status).toBe('open');
  });

  it('counts the segments the body needs — an approximation by length, and billed as such', async () => {
    carrier.answer = { status: 'sent' };
    const one = await send(mine, undefined, { body: 'a'.repeat(160) });
    const two = await send(mine, undefined, { body: 'a'.repeat(161) });
    expect(await usage(one.id)).toEqual([1]);
    expect(await usage(two.id)).toEqual([2]);
    // Known limit, pinned so it is a decision and not a surprise: length / 160 ignores that a body with a
    // character outside the GSM alphabet is carried as Unicode, 70 to a segment, and that a long message's
    // segments hold 153. The carrier's own count is the exact one; this meter is an estimate.
    const emoji = await send(mine, undefined, { body: '🙂'.repeat(70) });
    expect((await usage(emoji.id))[0]).toBeGreaterThanOrEqual(1);
  });
});

describe('a callback names a text, and nothing else', () => {
  it('ignores an id nobody here sent, and a status this platform does not know', async () => {
    expect(await status(`SM${randomUUID()}`, 'delivered')).toBeNull();
    await expect(status('anything', 'receiving')).rejects.toThrow(/unknown message status/);
  });

  it('acts on neither of two businesses when they somehow share a carrier id', async () => {
    const a = await send(mine);
    const b = await send(other);
    const shared = `SMshared${randomUUID().slice(0, 8)}`;
    await pg.query(`update public.messages set external_id = $1 where id = any($2::uuid[])`, [shared, [a.id]]);
    await pg.query(`update public.messages set external_id = $1 where id = $2`, [shared, b.id]);

    expect(await status(shared, 'delivered')).toBeNull();
    expect((await message(a.id)).status).toBe('queued');
    expect((await message(b.id)).status).toBe('queued');
  });

  it('moves only the business it belongs to', async () => {
    const a = await send(mine);
    const b = await send(other);
    await status((await message(b.id)).external_id, 'delivered');
    expect((await message(b.id)).status).toBe('delivered');
    expect((await message(a.id)).status).toBe('queued');
  });

  it('cannot give a number a provider resource of another business', async () => {
    await expect(pg.query(`update public.phone_numbers set provider_resource_id = $1 where id = $2`, [other.resourceId, mine.secondNumberId])).rejects.toMatchObject({ code: '23503' });
  });
});

describe('an inbound text', () => {
  it('lands in the right business’s conversation as unread and open, and resolves a known customer by E.164', async () => {
    const phone = freshNumber();
    const customerId = await createCustomer(mine.db as never, { organizationId: mine.organizationId, name: 'Known Kay', phone: `${phone.slice(0, 2)} ${phone.slice(2, 5)}-${phone.slice(5)}` });
    const id = (await inbound(mine, phone, 'Is Thursday okay?'))!;
    const conv = await conversation((await message(id)).conversation_id);
    expect(conv).toMatchObject({ status: 'open', unread: true, customer_id: customerId });
    expect((await message(id)).status).toBe('delivered');
  });

  it('is metered once, as a received text', async () => {
    const id = (await inbound(mine, freshNumber(), 'x'.repeat(200)))!;
    expect(await usage(id)).toEqual([2]);
  });

  it('is nothing new the second time: a retried callback does not re-mark a read conversation unread, move it, or bill again', async () => {
    const from = freshNumber();
    const sid = `SM${randomUUID()}`;
    const id = (await inbound(mine, from, 'Hello', sid))!;
    const conv = (await message(id)).conversation_id;
    await pg.query(`update public.conversations set unread = false, last_message_at = now() - interval '1 hour' where id = $1`, [conv]);
    const before = await conversation(conv);

    expect(await inbound(mine, from, 'Hello', sid)).toBeNull();
    const after = await conversation(conv);
    expect(after.unread).toBe(false);
    expect(after.last_message_at).toEqual(before.last_message_at);
    expect(await usage(id)).toEqual([1]);
    expect(Number((await pg.query(`select count(*) from public.messages where conversation_id = $1`, [conv])).rows[0].count)).toBe(1);
  });

  it('reopens a closed conversation when they write again', async () => {
    const from = freshNumber();
    const first = (await inbound(mine, from))!;
    const conv = (await message(first)).conversation_id;
    await setConversationStatus(mine.db as never, { organizationId: mine.organizationId, conversationId: conv, status: 'closed' });
    await inbound(mine, from, 'Hello again');
    expect((await conversation(conv)).status).toBe('open');
  });

  it('is accepted only at a number that is exactly one business’s and active', async () => {
    const stranger = freshNumber();
    await asRole('sms_webhook', `select public.record_inbound_message($1, $2, $3, 'hi')`, [stranger, freshNumber(), `SM${randomUUID()}`]);
    expect(Number((await pg.query(`select count(*) from public.conversations where external_number is not null and organization_id in ($1, $2) and last_message_preview = 'hi'`, [mine.organizationId, other.organizationId])).rows[0].count)).toBe(0);

    await pg.query(`update public.phone_numbers set lifecycle = 'inactive' where id = $1`, [mine.secondNumberId]);
    const second = (await pg.query(`select e164 from public.phone_numbers where id = $1`, [mine.secondNumberId])).rows[0].e164;
    const idle = await asRole<{ r: string | null }>('sms_webhook', `select public.record_inbound_message($1, $2, $3, 'hi') as r`, [second, freshNumber(), `SM${randomUUID()}`]);
    expect(idle[0].r).toBeNull();
    await pg.query(`update public.phone_numbers set lifecycle = 'active' where id = $1`, [mine.secondNumberId]);

    // Two businesses holding one number: not anyone's.
    const shared = freshNumber();
    const resourceFor = async (tenant: Tenant) => recordProviderResource(staff, { organizationId: tenant.organizationId, providerKey: 'twilio', resourceType: 'twilio_phone_number', externalId: `PN${randomUUID().replace(/-/g, '').slice(0, 32)}` });
    await staff.rpc('sync_phone_number', { p_organization_id: mine.organizationId, p_provider_resource_id: await resourceFor(mine), p_e164: shared });
    await staff.rpc('sync_phone_number', { p_organization_id: other.organizationId, p_provider_resource_id: await resourceFor(other), p_e164: shared });
    const both = await asRole<{ r: string | null }>('sms_webhook', `select public.record_inbound_message($1, $2, $3, 'hi') as r`, [shared, freshNumber(), `SM${randomUUID()}`]);
    expect(both[0].r).toBeNull();
  });
});

describe('suppression', () => {
  const stop = (tenant: Tenant, from: string, optedOut: boolean) =>
    asRole('sms_webhook', `select public.record_message_suppression($1, $2, $3)`, [tenant.e164, from, optedOut]);

  it('stops a business texting a number that said STOP, from any of its numbers, until START', async () => {
    const recipient = freshNumber();
    await stop(mine, recipient, true);

    await expect(send(mine, recipient)).rejects.toMatchObject({ code: 'messaging.recipient_opted_out' });
    await expect(send(mine, recipient, { numberId: mine.secondNumberId })).rejects.toMatchObject({ code: 'messaging.recipient_opted_out' });
    expect(carrier.calls).toEqual([]);

    // And through the reply command, the other way into the same send.
    const conv = (await mine.db.from('conversations').insert({ organization_id: mine.organizationId, phone_number_id: mine.numberId, external_number: recipient }).select('id').single()).data!.id as string;
    await expect(replyToConversation(mine.db as never, { organizationId: mine.organizationId, conversationId: conv, body: 'hi', idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'messaging.recipient_opted_out' });

    await stop(mine, recipient, false);
    await expect(send(mine, recipient)).resolves.toBeDefined();
  });

  it('belongs to one business: an opt-out recorded for another does not reach this one', async () => {
    const recipient = freshNumber();
    await stop(other, recipient, true);
    await expect(send(mine, recipient)).resolves.toBeDefined();
  });

  it('is read by the business that holds it and nobody else', async () => {
    const recipient = freshNumber();
    await stop(mine, recipient, true);
    expect(((await mine.db.from('messaging_opt_outs').select('external_number').eq('external_number', recipient)).data ?? []).length).toBe(1);
    expect((await other.db.from('messaging_opt_outs').select('external_number').eq('external_number', recipient)).data ?? []).toEqual([]);
  });
});

describe('one conversation screen, one inbox', () => {
  it('shows a text in the canonical Inbox and Conversation Detail with its real delivery state', async () => {
    carrier.answer = { status: 'sent' };
    const sent = await send(mine, '+14165550151');
    const conv = (await message(sent.id)).conversation_id;
    const membershipId = mine.membershipId;

    const item = (await listInbox(mine.db as never, { organizationId: mine.organizationId, filter: { channel: 'sms', status: 'any' }, membershipId })).items.find((i) => i.id === conv);
    expect(item).toMatchObject({ channel: 'sms', title: '+14165550151', status: 'waiting' });

    const detail = await getConversationDetail(mine.db as never, { organizationId: mine.organizationId, conversationId: conv });
    expect(detail!.timeline.channel).toBe('sms');
    expect(detail!.timeline.channel === 'sms' && detail!.timeline.messages[0]).toMatchObject({ direction: 'outbound', status: 'sent' });
  });

  it('shows another business none of it', async () => {
    const sent = await send(mine, '+14165550152');
    const conv = (await message(sent.id)).conversation_id;
    expect(await getConversationDetail(other.db as never, { organizationId: mine.organizationId, conversationId: conv })).toBeNull();
    expect((await listInbox(other.db as never, { organizationId: mine.organizationId, filter: { status: 'any' } })).items).toEqual([]);
  });
});
