import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmailIdentity } from '@/lib/domain/email/identities';
import { listEmailThread, readAttachment, sendEmail } from '@/lib/domain/email/messages';
import { replyToConversation } from '@/lib/domain/reception/outbound';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The domain commands against real Postgres, real RLS and real Storage, with the one thing that
 * would reach a provider — the tenant email capability — replaced by a recorder.
 *
 * What the recorder sees is the point: it is handed a *message id* and nothing else, so there is
 * no `from` anywhere on this path to be spoofed. The messages it is handed exist, queued, before it
 * is called, and what it answers changes nothing about that (the provider runtime, not this code, is
 * what records a provider's answer).
 */

type Submission = { organizationId: string; messageId: string };
const provider = vi.hoisted(() => ({
  calls: [] as Submission[],
  outcome: { status: 'accepted', externalId: 're_x' } as { status: string; [key: string]: unknown },
  available: true,
}));

vi.mock('@/lib/adapters/tenant-email', () => ({
  emailProvider: async () =>
    provider.available
      ? {
          sendEmail: async (input: Submission) => {
            provider.calls.push(input);
            return provider.outcome;
          },
        }
      : null,
}));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; domain: string; domainResourceId: string; identityId: string; address: string };
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
  const identity = await createEmailIdentity(db as never, { organizationId, address, sendingDomainResourceId: named.data as string });

  await pg.query('begin');
  await pg.query('set local role provider_operator');
  await pg.query(`select public.record_email_domain_provisioning($1, $2, 'active')`, [organizationId, named.data]);
  await pg.query('commit');
  return { db, userId: created.data.user.id, organizationId, domain, domainResourceId: named.data as string, identityId: identity.id, address };
}

beforeAll(async () => {
  pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  [mine, other] = await Promise.all([newTenant('es-a'), newTenant('es-b')]);
}, 90_000);

afterAll(async () => {
  await pg.end();
});

beforeEach(() => {
  provider.calls.length = 0;
  provider.outcome = { status: 'accepted', externalId: 're_x' };
  provider.available = true;
});

const send = (tenant: Tenant, extra: Partial<Parameters<typeof sendEmail>[1]> = {}) =>
  sendEmail(tenant.db as never, {
    organizationId: tenant.organizationId,
    emailIdentityId: tenant.identityId,
    to: 'kim@example.test',
    subject: 'Your quote',
    text: 'Here it is.',
    idempotencyKey: randomUUID(),
    ...extra,
  });

const statusOf = async (id: string) => (await pg.query(`select status, failure_reason from public.messages where id = $1`, [id])).rows[0];

describe('SendEmail', () => {
  it('queues a durable message first, then hands the provider only its id', async () => {
    const result = await send(mine);

    expect(result.outcome).toBe('accepted');
    expect(provider.calls).toEqual([{ organizationId: mine.organizationId, messageId: result.messageId }]);
    // Accepted by the provider runtime is *its* write to make; this layer never marks a message sent.
    expect((await statusOf(result.messageId)).status).toBe('queued');
  });

  it('is one message however many times the same composition is submitted', async () => {
    const key = randomUUID();
    const a = await send(mine, { idempotencyKey: key });
    const b = await send(mine, { idempotencyKey: key });

    expect(b.messageId).toBe(a.messageId);
    expect(Number((await pg.query(`select count(*) from public.messages where organization_id = $1 and idempotency_key = $2`, [mine.organizationId, key])).rows[0].count)).toBe(1);
  });

  it('does not send at all when the address cannot', async () => {
    await expect(send(mine, { emailIdentityId: other.identityId })).rejects.toMatchObject({ code: 'email.forbidden' });
    expect(provider.calls).toEqual([]);

    await expect(send(mine, { to: 'not-an-address' })).rejects.toMatchObject({ code: 'email.invalid' });
    expect(provider.calls).toEqual([]);
  });

  it('leaves a message that could not be handed over queued and real, so sending it again is the same message', async () => {
    provider.available = false;
    const result = await send(mine);

    expect(result.outcome).toBe('unavailable');
    expect((await statusOf(result.messageId)).status).toBe('queued');
    expect(Number((await pg.query(`select count(*) from public.messages where id = $1`, [result.messageId])).rows[0].count)).toBe(1);

    // The same composition retried when the deployment can send hands over the same message.
    provider.available = true;
    const again = await sendEmail(mine.db as never, {
      organizationId: mine.organizationId, emailIdentityId: mine.identityId, to: 'kim@example.test', subject: 'Your quote', text: 'Here it is.',
      idempotencyKey: (await pg.query(`select idempotency_key from public.messages where id = $1`, [result.messageId])).rows[0].idempotency_key,
    });
    expect(again.messageId).toBe(result.messageId);
    expect(provider.calls.at(-1)?.messageId).toBe(result.messageId);
  });

  it('reports a provider refusal as it was said, and a message already taken as in progress', async () => {
    provider.outcome = { status: 'rejected', detail: 'Invalid recipient' };
    const refused = await send(mine);
    expect(refused).toMatchObject({ outcome: 'rejected', detail: 'Invalid recipient' });

    provider.outcome = { status: 'in_progress' };
    expect((await send(mine)).outcome).toBe('in_progress');
  });

  it('does not hand the provider a message that is no longer waiting', async () => {
    const first = await send(mine);
    await pg.query('begin');
    await pg.query('set local role provider_operator');
    await pg.query(`select public.claim_email_for_send($1, $2)`, [mine.organizationId, first.messageId]);
    await pg.query('commit');
    provider.calls.length = 0;

    const key = (await pg.query(`select idempotency_key from public.messages where id = $1`, [first.messageId])).rows[0].idempotency_key;
    const again = await sendEmail(mine.db as never, {
      organizationId: mine.organizationId, emailIdentityId: mine.identityId, to: 'kim@example.test', subject: 'Your quote', text: 'Here it is.', idempotencyKey: key,
    });
    expect(again.outcome).toBe('in_progress');
    expect(provider.calls).toEqual([]);
  });
});

describe('attachments on a send', () => {
  const file = (name: string, bytes: string) => new File([bytes], name, { type: 'text/plain' });

  it('uploads under the business’s own folder and attaches the file to the message', async () => {
    const result = await send(mine, { files: [file('terms.txt', 'the terms')] });
    const rows = (await pg.query(`select filename, storage_state, storage_path from public.message_attachments where message_id = $1`, [result.messageId])).rows;

    expect(rows).toHaveLength(1);
    expect(rows[0].storage_path).toMatch(new RegExp(`^${mine.organizationId}/outbound/`));
    const thread = await listEmailThread(mine.db as never, { organizationId: mine.organizationId, conversationId: result.conversationId });
    expect(thread[0].attachments[0]).toMatchObject({ filename: 'terms.txt', state: 'stored' });

    const stored = await readAttachment(mine.db as never, { organizationId: mine.organizationId, attachmentId: thread[0].attachments[0].id });
    expect(new TextDecoder().decode(stored.bytes)).toBe('the terms');
  });

  it('refuses another business reading it, by attachment id, and strands no upload when a send is refused', async () => {
    const result = await send(mine, { files: [file('private.txt', 'secret')] });
    const thread = await listEmailThread(mine.db as never, { organizationId: mine.organizationId, conversationId: result.conversationId });
    const attachmentId = thread[0].attachments[0].id;

    await expect(readAttachment(other.db as never, { organizationId: other.organizationId, attachmentId })).rejects.toMatchObject({ code: 'email.attachment_not_found' });
    await expect(readAttachment(other.db as never, { organizationId: mine.organizationId, attachmentId })).rejects.toMatchObject({ code: 'email.attachment_not_found' });

    const before = (await pg.query(`select count(*) from storage.objects where bucket_id = 'communications' and name like $1`, [`${mine.organizationId}/outbound/%`])).rows[0].count;
    await expect(send(mine, { to: 'bad', files: [file('orphan.txt', 'x')] })).rejects.toMatchObject({ code: 'email.invalid' });
    const after = (await pg.query(`select count(*) from storage.objects where bucket_id = 'communications' and name like $1`, [`${mine.organizationId}/outbound/%`])).rows[0].count;
    expect(after).toBe(before);
  });

  it('refuses unsafe or oversized files before anything is uploaded', async () => {
    await expect(send(mine, { files: [file('run.exe', 'MZ')] })).rejects.toMatchObject({ code: 'email.attachment_invalid' });
    await expect(send(mine, { files: [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.bin')] })).rejects.toMatchObject({ code: 'email.attachment_invalid' });
  });
});

describe('ReplyToConversation', () => {
  it('replies inside an email conversation as the address it is on, to the person it is with', async () => {
    const first = await send(mine, { to: 'reply@example.test', subject: 'Original' });
    provider.calls.length = 0;

    const reply = await replyToConversation(mine.db as never, {
      organizationId: mine.organizationId, conversationId: first.conversationId, body: 'Following up.', idempotencyKey: randomUUID(),
    });
    expect(reply).toMatchObject({ channel: 'email', conversationId: first.conversationId, outcome: 'accepted' });
    expect(provider.calls).toHaveLength(1);

    const detail = (await pg.query(`select subject, from_address, to_addresses from public.email_message_details where message_id = $1`, [(reply as { messageId: string }).messageId])).rows[0];
    expect(detail).toEqual({ subject: 'Re: Original', from_address: mine.address, to_addresses: ['reply@example.test'] });
  });

  it('refuses a reply into another business’s conversation', async () => {
    const theirs = await send(other, { to: 'them@example.test' });
    await expect(
      replyToConversation(mine.db as never, { organizationId: mine.organizationId, conversationId: theirs.conversationId, body: 'x', idempotencyKey: randomUUID() }),
    ).rejects.toMatchObject({ code: 'messaging.conversation_not_found' });
  });
});

describe('reading a thread', () => {
  it('never hands a screen raw HTML: a received message arrives sanitized, with its text and its delivery history', async () => {
    await mine.db.from('email_identities').update({ can_receive: true }).eq('id', mine.identityId);
    await pg.query('begin');
    await pg.query('set local role tenant_email_webhook');
    const res = await pg.query(
      `select public.record_inbound_email($1, 'stranger@example.test', $2, $3, $4, null, '{}', 'Hello', 'plain words', $5, now(), null, '[]'::jsonb) as r`,
      [[mine.address], `in_${randomUUID()}`, `evt_${randomUUID()}`, `<${randomUUID()}@x>`, '<p onclick="steal()">Hi <img src="https://t.test/p.gif"></p><script>alert(1)</script><a href="javascript:alert(1)">x</a>'],
    );
    await pg.query('commit');
    const messageId = (res.rows[0].r as { message_id: string }).message_id;
    const conversation = (await pg.query(`select conversation_id from public.messages where id = $1`, [messageId])).rows[0].conversation_id;

    const [message] = await listEmailThread(mine.db as never, { organizationId: mine.organizationId, conversationId: conversation });
    expect(message).toMatchObject({ direction: 'inbound', from: 'stranger@example.test', text: 'plain words', status: 'delivered' });
    expect(message.safeHtml).toContain('Hi');
    expect(message.safeHtml).not.toMatch(/script|onclick|<img|javascript:/i);
    expect(message.events.map((event) => event.type)).toContain('received');
    expect(Object.keys(message)).not.toContain('html');
  });

  it('shows another business nothing of this thread', async () => {
    const result = await send(mine);
    expect(await listEmailThread(other.db as never, { organizationId: mine.organizationId, conversationId: result.conversationId })).toEqual([]);
  });
});
