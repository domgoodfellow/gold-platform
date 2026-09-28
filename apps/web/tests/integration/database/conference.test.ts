import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Work Order 4's backend half: participant operations on a conference that already exists. Every
 * write here goes through `add_call_participant`/`remove_call_participant`/
 * `set_participant_hold`/`set_participant_muted` — proven directly against Postgres, the same way
 * `provider-bindings.test.ts` proves its own narrow doors, because none of this needs a live
 * carrier to be true: authorization, tenant isolation and lifecycle are database facts before
 * they are ever a browser's problem.
 *
 * A call and its two starting legs are made with `open_call` directly (also carrier-free) rather
 * than `placeCall`, so this suite runs without `TWILIO_*` configured.
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
  // XXX (ISO 4217's own "no currency" code) rather than CAD: the launch commercial snapshot
  // seeds a real voice_minutes rate for CAD, which would refuse `open_call` on an empty purse —
  // this suite is about participant operations, not credit, so it stays on a currency nothing
  // prices (`communications.test.ts` owns the credit-gating assertions themselves).
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'XXX' });
  return { db, email, userId, organizationId };
}

/**
 * `open_call` takes no agent argument — the agent is `created_by`, read by a trigger
 * (`app.open_call_legs`) that writes both starting legs once the row exists, not by this
 * function itself (`20260905000004_a_channel_costs_something_and_credit_is_bought_in_advance.sql`).
 */
async function openCall(tenant: Tenant, customerId: string): Promise<string> {
  const { data, error } = await tenant.db.rpc('open_call', {
    p_organization_id: tenant.organizationId,
    p_customer_id: customerId,
    p_conference_name: `gold-${randomUUID()}`,
    p_from_number: '+14165550100',
    p_to_number: '+14165550101',
  });
  if (error) throw error;
  return data as string;
}

let mine: Tenant;
let other: Tenant;
let customerId: string;

beforeAll(async () => {
  [mine, other] = await Promise.all([newTenant('conf-a'), newTenant('conf-b')]);
  customerId = await createCustomer(mine.db, { organizationId: mine.organizationId, name: 'Ada Customer' });
}, 60_000);

describe('a conference already exists; a participant is one operation on it (D38)', () => {
  it('adds a fourth party and reads the row back, tenant-scoped', async () => {
    const callId = await openCall(mine, customerId);

    const { data: participantId, error } = await mine.db.rpc('add_call_participant', {
      p_organization_id: mine.organizationId,
      p_call_id: callId,
      p_party: 'transfer_target',
    });
    expect(error).toBeNull();
    expect(participantId).toBeTruthy();

    const { data: row } = await mine.db
      .from('call_participants')
      .select('party, status, on_hold, muted, left_at')
      .eq('id', participantId as string)
      .single();
    expect(row).toMatchObject({ party: 'transfer_target', status: 'ringing', on_hold: false, muted: false, left_at: null });
  });

  it('never lets another organization add a participant to a call it does not own', async () => {
    const callId = await openCall(mine, customerId);

    const { error } = await other.db.rpc('add_call_participant', {
      p_organization_id: other.organizationId,
      p_call_id: callId,
      p_party: 'transfer_target',
    });
    expect(error).not.toBeNull();
  });

  it('refuses an organization id the caller does not belong to, even naming a call of its own making up the id', async () => {
    const callId = await openCall(mine, customerId);

    // `other` is signed in as a different business; supplying `mine`'s organization id does not
    // borrow its membership (D17) — RLS/`app.current_tenant_ids()` decides, not the argument.
    const { error } = await other.db.rpc('add_call_participant', {
      p_organization_id: mine.organizationId,
      p_call_id: callId,
      p_party: 'transfer_target',
    });
    expect(error).not.toBeNull();
  });

  it('holds and resumes a leg, and the state is readable back', async () => {
    const callId = await openCall(mine, customerId);
    const { data: participants } = await mine.db.from('call_participants').select('id, party').eq('call_id', callId);
    const customerLeg = (participants ?? []).find((row: { party: string }) => row.party === 'customer')!;

    await mine.db.rpc('set_participant_hold', { p_organization_id: mine.organizationId, p_participant_id: customerLeg.id, p_hold: true });
    const held = await mine.db.from('call_participants').select('on_hold').eq('id', customerLeg.id).single();
    expect(held.data?.on_hold).toBe(true);

    await mine.db.rpc('set_participant_hold', { p_organization_id: mine.organizationId, p_participant_id: customerLeg.id, p_hold: false });
    const resumed = await mine.db.from('call_participants').select('on_hold').eq('id', customerLeg.id).single();
    expect(resumed.data?.on_hold).toBe(false);
  });

  it('mutes a leg independently of hold', async () => {
    const callId = await openCall(mine, customerId);
    const { data: participants } = await mine.db.from('call_participants').select('id, party').eq('call_id', callId);
    const agentLeg = (participants ?? []).find((row: { party: string }) => row.party === 'agent')!;

    await mine.db.rpc('set_participant_muted', { p_organization_id: mine.organizationId, p_participant_id: agentLeg.id, p_muted: true });
    const row = await mine.db.from('call_participants').select('muted, on_hold').eq('id', agentLeg.id).single();
    expect(row.data).toMatchObject({ muted: true, on_hold: false });
  });

  it('removes one leg without ending the conference for the rest — the whole reason D38 chose a room', async () => {
    const callId = await openCall(mine, customerId);
    const { data: participantId } = await mine.db.rpc('add_call_participant', {
      p_organization_id: mine.organizationId,
      p_call_id: callId,
      p_party: 'transfer_target',
    });

    const { error } = await mine.db.rpc('remove_call_participant', { p_organization_id: mine.organizationId, p_participant_id: participantId as string });
    expect(error).toBeNull();

    const removed = await mine.db.from('call_participants').select('status, left_at').eq('id', participantId as string).single();
    expect(removed.data?.status).toBe('completed');
    expect(removed.data?.left_at).not.toBeNull();

    // The other two legs this call started with are untouched.
    const { data: rest } = await mine.db.from('call_participants').select('status, left_at').eq('call_id', callId).neq('id', participantId as string);
    expect((rest ?? []).every((row: { left_at: string | null }) => row.left_at === null)).toBe(true);
  });

  it('refuses to remove a participant twice — idempotency at the write, not just the read', async () => {
    const callId = await openCall(mine, customerId);
    const { data: participantId } = await mine.db.rpc('add_call_participant', {
      p_organization_id: mine.organizationId,
      p_call_id: callId,
      p_party: 'transfer_target',
    });

    await mine.db.rpc('remove_call_participant', { p_organization_id: mine.organizationId, p_participant_id: participantId as string });
    const { error: second } = await mine.db.rpc('remove_call_participant', { p_organization_id: mine.organizationId, p_participant_id: participantId as string });
    expect(second).not.toBeNull();
  });

  it('refuses a caller without call.place, the same policy that governs placing one', async () => {
    const callId = await openCall(mine, customerId);

    const { email } = await account('viewer');
    const roleId = await createRole(mine.db, { organizationId: mine.organizationId, name: `Viewer ${randomUUID().slice(0, 8)}`, capabilities: [] });
    await addMember(mine.db, { organizationId: mine.organizationId, email, displayName: 'No Capabilities', roleId });

    // Signing in again rather than reusing the client `account` returned, because the tenant
    // claim is read at sign-in and the membership above was written after that session began
    // (the same reason `reception.test.ts`'s own capability-refusal test does this).
    const reader = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    expect(link).toBeTruthy();

    const { error } = await reader.rpc('add_call_participant', {
      p_organization_id: mine.organizationId,
      p_call_id: callId,
      p_party: 'transfer_target',
    });
    expect(error).not.toBeNull();
  });

  it('accepts transfer_target as a fourth conference role beside agent, customer and supervisor', async () => {
    const callId = await openCall(mine, customerId);
    const { error } = await mine.db.rpc('add_call_participant', {
      p_organization_id: mine.organizationId,
      p_call_id: callId,
      p_party: 'transfer_target',
    });
    expect(error).toBeNull();
  });
});
