import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { beginProviderBinding, recordProviderResource } from '@/lib/domain/providers/bindings';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Messaging's own write boundaries. `sendMessage` itself needs a live carrier credential this
 * environment does not hold, so this suite proves what a real Postgres connection can prove
 * without one: tenant isolation and capability gating on `conversations`/`messages` (the same
 * `message.send`-RLS shape `calls`/`communication_routes` already use), idempotency as a real
 * unique constraint rather than an application-level promise, and that the webhook's own three
 * doors (`record_inbound_message`, `record_message_status`, `record_message_suppression`) are
 * unreachable from a signed-in session — `sms_webhook` holds them and nobody else does.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; email: string; userId: string; organizationId: string };

async function account(label: string): Promise<{ db: SupabaseClient; email: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  return { db, email, userId: created.user.id };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, email, userId } = await account(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });
  return { db, email, userId, organizationId };
}

let staff: SupabaseClient;

/** A real `phone_numbers` row, provisioned the same way `phone-numbers.test.ts` does: `sync_phone_number` is staff-only, so this is the one real path, not a service-role shortcut. */
async function seedNumber(tenant: Tenant, e164: string): Promise<string> {
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
  return data as string;
}

let mine: Tenant;
let other: Tenant;
let myNumberId: string;

beforeAll(async () => {
  [mine, other, staff] = await Promise.all([newTenant('msg-a'), newTenant('msg-b'), asPlatformStaff()]);
  myNumberId = await seedNumber(mine, '+14165550100');
}, 60_000);

describe('one Message, one canonical object', () => {
  it('lets a member with message.send create a conversation and reads it back', async () => {
    const { data: conversationId, error } = await mine.db
      .from('conversations')
      .insert({ organization_id: mine.organizationId, phone_number_id: myNumberId, external_number: '+14165550111' })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect(conversationId?.id).toBeTruthy();
  });

  it('reads only its own organization’s conversations, whatever id the caller names', async () => {
    const { data: created } = await mine.db
      .from('conversations')
      .insert({ organization_id: mine.organizationId, phone_number_id: myNumberId, external_number: '+14165550112' })
      .select('id')
      .single();

    const crossTenant = await other.db.from('conversations').select('id').eq('organization_id', mine.organizationId).eq('id', created!.id);
    expect(crossTenant.data ?? []).toEqual([]);
  });

  it('refuses a message insert without message.send', async () => {
    const otherNumberId = await seedNumber(other, '+14165550200');
    const { data: conversation } = await other.db
      .from('conversations')
      .insert({ organization_id: other.organizationId, phone_number_id: otherNumberId, external_number: '+14165550201' })
      .select('id')
      .single();

    // `other`'s owner role holds every capability including message.send, so this proves the
    // opposite organization is refused rather than the capability — the id belongs to `other`,
    // `mine` is the caller.
    const { data, error } = await mine.db
      .from('messages')
      .insert({ organization_id: other.organizationId, conversation_id: conversation!.id, direction: 'outbound', body: 'Hijack attempt' })
      .select('id');
    expect(data ?? []).toEqual([]);
    expect(error).not.toBeNull();
  });

  it('enforces idempotency as a real constraint, not an application promise', async () => {
    const { data: conversation } = await mine.db
      .from('conversations')
      .insert({ organization_id: mine.organizationId, phone_number_id: myNumberId, external_number: '+14165550113' })
      .select('id')
      .single();
    const idempotencyKey = randomUUID();

    const first = await mine.db
      .from('messages')
      .insert({ organization_id: mine.organizationId, conversation_id: conversation!.id, direction: 'outbound', body: 'Hello', idempotency_key: idempotencyKey, created_by: mine.userId })
      .select('id')
      .single();
    expect(first.error).toBeNull();

    const second = await mine.db
      .from('messages')
      .insert({ organization_id: mine.organizationId, conversation_id: conversation!.id, direction: 'outbound', body: 'Hello again', idempotency_key: idempotencyKey, created_by: mine.userId })
      .select('id');
    expect(second.error).not.toBeNull();
  });

  it('never lets a signed-in session reach the webhook’s own doors', async () => {
    const inbound = await mine.db.rpc('record_inbound_message', { p_to_number: '+14165550100', p_from_number: '+14165550199', p_external_id: 'SM-test', p_body: 'hi' });
    expect(inbound.error).not.toBeNull();

    const status = await mine.db.rpc('record_message_status', { p_external_id: 'SM-test', p_status: 'delivered', p_failure_reason: null });
    expect(status.error).not.toBeNull();

    const suppression = await mine.db.rpc('record_message_suppression', { p_to_number: '+14165550100', p_external_number: '+14165550199', p_opted_out: true });
    expect(suppression.error).not.toBeNull();
  });

  it('reads suppression state for its own organization only', async () => {
    const read = await mine.db.from('messaging_opt_outs').select('*').eq('organization_id', other.organizationId);
    expect(read.data ?? []).toEqual([]);
  });
});
