import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { beginProviderBinding, recordProviderResource } from '@/lib/domain/providers/bindings';
import { sendSms } from '@/lib/domain/reception/messaging';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Who a text is sent *from* is decided by the server, against real Postgres and real RLS.
 *
 * The carrier needs a credential this environment does not hold, so the one thing replaced is the
 * messaging adapter — a recorder standing where the carrier would. Everything above it is real:
 * the signed-in session, the number lookup under RLS, the idempotency constraint, the conversation
 * the send creates. That is what lets this prove the provider is handed the number the *server*
 * resolved from an id, and never one a caller typed.
 */

const sent = vi.hoisted(() => [] as Array<{ from: string; to: string; body: string; reportTo: string }>);

vi.mock('@/lib/adapters/messaging', () => ({
  messagingCallbackBase: () => 'https://callbacks.example.test',
  messagingProvider: async () => ({
    sendMessage: async (input: { from: string; to: string; body: string; reportTo: string }) => {
      sent.push(input);
      return { externalId: `SM${randomUUID().replace(/-/g, '')}`, status: 'sent' as const };
    },
  }),
}));

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let pg: Client;
let staff: SupabaseClient;
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
  return { db, userId: created.data.user.id, organizationId };
}

/** A real provisioned number, through the one staff door that creates one. Returns its id and its provider resource. */
async function seedNumber(tenant: Tenant, e164: string): Promise<{ id: string; resourceId: string }> {
  await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
  const resourceId = await recordProviderResource(staff, {
    organizationId: tenant.organizationId,
    providerKey: 'twilio',
    resourceType: 'twilio_phone_number',
    externalId: `PN${randomUUID().replace(/-/g, '').slice(0, 32)}`,
  });
  const { data, error } = await staff.rpc('sync_phone_number', {
    p_organization_id: tenant.organizationId,
    p_provider_resource_id: resourceId,
    p_e164: e164,
  });
  if (error) throw error;
  return { id: data as string, resourceId };
}

const send = (tenant: Tenant, input: { phoneNumberId: string; toNumber?: string; idempotencyKey?: string }) =>
  sendSms(tenant.db as never, {
    organizationId: tenant.organizationId,
    phoneNumberId: input.phoneNumberId,
    toNumber: input.toNumber ?? '+14165550142',
    body: 'Your appointment is tomorrow.',
    idempotencyKey: input.idempotencyKey ?? randomUUID(),
  });

beforeAll(async () => {
  pg = new Client({ connectionString: DB_URL });
  await pg.connect();
  [mine, other, staff] = await Promise.all([newTenant('sender-a'), newTenant('sender-b'), asPlatformStaff()]);
}, 60_000);

afterAll(async () => {
  await pg.end();
});

describe('the server resolves the sender from a number id', () => {
  it('hands the carrier the E.164 of the number it resolved, creates an SMS conversation, and sends once per key', async () => {
    const number = await seedNumber(mine, '+14165550301');
    const key = randomUUID();
    sent.length = 0;

    const first = await send(mine, { phoneNumberId: number.id, idempotencyKey: key });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: '+14165550301', to: '+14165550142' });

    const retry = await send(mine, { phoneNumberId: number.id, idempotencyKey: key });
    expect(retry.id).toBe(first.id);
    expect(sent).toHaveLength(1);

    const { data: conversation } = await mine.db
      .from('conversations')
      .select('channel, phone_number_id, external_number, email_identity_id')
      .eq('id', first.conversationId)
      .single();
    expect(conversation).toEqual({ channel: 'sms', phone_number_id: number.id, external_number: '+14165550142', email_identity_id: null });
  });

  it('keeps one conversation for the same pair of numbers across sends', async () => {
    const number = await seedNumber(mine, '+14165550302');
    const a = await send(mine, { phoneNumberId: number.id, toNumber: '+14165550150' });
    const b = await send(mine, { phoneNumberId: number.id, toNumber: '+14165550150' });
    expect(b.conversationId).toBe(a.conversationId);
  });

  it('ignores a sender address smuggled in beside the id — there is no field for one to land in', async () => {
    const number = await seedNumber(mine, '+14165550303');
    sent.length = 0;

    await sendSms(mine.db as never, {
      organizationId: mine.organizationId,
      phoneNumberId: number.id,
      // @ts-expect-error `fromNumber` is not part of the contract any more: the compiler refuses it...
      fromNumber: '+19995550100',
      toNumber: '+14165550142',
      body: 'Spoof attempt',
      idempotencyKey: randomUUID(),
    });

    // ...and a caller that evades the compiler still cannot make it the carrier's `from`.
    expect(sent.map((call) => call.from)).toEqual(['+14165550303']);
  });

  it('reads the recipient’s opt-out under the sender’s own session and refuses an opted-out number', async () => {
    const number = await seedNumber(mine, '+14165550310');
    await pg.query(
      `insert into public.messaging_opt_outs (organization_id, external_number, source) values ($1, '+14165550160', 'keyword')`,
      [mine.organizationId],
    );
    sent.length = 0;

    await expect(send(mine, { phoneNumberId: number.id, toNumber: '+14165550160' })).rejects.toMatchObject({ code: 'messaging.recipient_opted_out' });
    expect(sent).toHaveLength(0);
  });

  it('refuses another business’s number and never calls the carrier', async () => {
    const theirs = await seedNumber(other, '+14165550304');
    sent.length = 0;

    await expect(send(mine, { phoneNumberId: theirs.id })).rejects.toMatchObject({ code: 'messaging.sender_not_found' });
    expect(sent).toHaveLength(0);
  });

  it('refuses an id that names no number', async () => {
    await expect(send(mine, { phoneNumberId: randomUUID() })).rejects.toMatchObject({ code: 'messaging.sender_not_found' });
  });

  it('refuses a number that is not active', async () => {
    const number = await seedNumber(mine, '+14165550305');
    await pg.query(`update public.phone_numbers set lifecycle = 'inactive' where id = $1`, [number.id]);
    sent.length = 0;

    await expect(send(mine, { phoneNumberId: number.id })).rejects.toMatchObject({ code: 'messaging.sender_inactive' });
    expect(sent).toHaveLength(0);
  });

  it('refuses a number that is not enabled for outbound', async () => {
    const number = await seedNumber(mine, '+14165550306');
    await pg.query(`update public.phone_numbers set sms_outbound_enabled = false where id = $1`, [number.id]);

    await expect(send(mine, { phoneNumberId: number.id })).rejects.toMatchObject({ code: 'messaging.sender_not_outbound' });
  });

  it('refuses a number whose provider resource is not active', async () => {
    const number = await seedNumber(mine, '+14165550307');
    await pg.query(`update public.organization_provider_resources set status = 'disabled' where id = $1`, [number.resourceId]);

    await expect(send(mine, { phoneNumberId: number.id })).rejects.toMatchObject({ code: 'messaging.sender_unavailable' });
  });

  it('refuses an identity that is not a telephone number', async () => {
    const number = await seedNumber(mine, '+14165550308');
    await pg.query(`update public.phone_numbers set origin = 'browser', provider_resource_id = null, voice_inbound_enabled = false, sms_inbound_enabled = false where id = $1`, [number.id]);

    await expect(send(mine, { phoneNumberId: number.id })).rejects.toMatchObject({ code: 'messaging.sender_not_textable' });
  });

  it('lets an external number send on its lifecycle and direction alone', async () => {
    const number = await seedNumber(mine, '+14165550309');
    await pg.query(`update public.phone_numbers set origin = 'external', provider_resource_id = null, voice_inbound_enabled = false, sms_inbound_enabled = false where id = $1`, [number.id]);
    sent.length = 0;

    await send(mine, { phoneNumberId: number.id });
    expect(sent.map((call) => call.from)).toEqual(['+14165550309']);
  });
});
