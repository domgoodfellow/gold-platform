import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { beginProviderBinding, recordProviderResource } from '@/lib/domain/providers/bindings';
import { getPhoneNumber, listPhoneNumbers } from '@/lib/domain/reception/numbers';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * The Numbers vertical (Work Order 3): a number's origin is real vocabulary now, and the one
 * writer that has ever created a `phone_numbers` row (`sync_phone_number`, staff-only) is proven
 * to record who did it — the audit gap Work Order 2 found and this slice closes for the one
 * reachable writer. Organization-integrity: a business reads only its own numbers, regardless of
 * which organization id a caller supplies (RLS decides, not the argument — D17).
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

async function account(label: string): Promise<{ db: SupabaseClient; email: string; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 8)}`,
    currency: 'CAD',
  });
  return { db, userId, organizationId };
}

let mine: Tenant;
let other: Tenant;
let staff: SupabaseClient;
let staffUserId: string;

beforeAll(async () => {
  [mine, other, staff] = await Promise.all([newTenant('numbers-a'), newTenant('numbers-b'), asPlatformStaff()]);
  staffUserId = (await staff.auth.getUser()).data.user!.id;
}, 60_000);

async function provisionOneNumber(organizationId: string, e164: string): Promise<string> {
  await beginProviderBinding(staff, { organizationId, providerKey: 'twilio' });
  const resourceId = await recordProviderResource(staff, {
    organizationId,
    providerKey: 'twilio',
    resourceType: 'twilio_phone_number',
    externalId: `PN${randomUUID().replace(/-/g, '').slice(0, 32)}`,
  });
  const { data, error } = await staff.rpc('sync_phone_number', {
    p_organization_id: organizationId,
    p_provider_resource_id: resourceId,
    p_e164: e164,
  });
  if (error) throw error;
  return data as string;
}

describe('a number names where it came from', () => {
  it('records the acting staff member as created_by — the audit gap Work Order 2 found', async () => {
    const e164 = `+1416555${Math.floor(1000 + Math.random() * 8999)}`;
    await provisionOneNumber(mine.organizationId, e164);

    const numbers = await listPhoneNumbers(mine.db, { organizationId: mine.organizationId });
    const created = numbers.find((number) => number.e164 === e164);
    expect(created).toBeDefined();
    expect(created!.origin).toBe('provisioned');
    expect(created!.providerResourceId).not.toBeNull();

    // `created_by` is not selectable through `listPhoneNumbers`/`getPhoneNumber`'s public shape
    // today (neither type exposes it to a screen) — read it directly to prove the column itself,
    // the same way the domain layer's own RLS-scoped client would.
    const { data: row, error } = await mine.db
      .from('phone_numbers')
      .select('created_by')
      .eq('organization_id', mine.organizationId)
      .eq('e164', e164)
      .single();
    expect(error).toBeNull();
    expect(row!.created_by).toBe(staffUserId);
  });

  it('reads only its own organization’s number, whatever organization id the caller names', async () => {
    const e164 = `+1416555${Math.floor(1000 + Math.random() * 8999)}`;
    const id = await provisionOneNumber(mine.organizationId, e164);

    // `other` is signed in as a different business entirely; RLS refuses the row regardless of
    // which organization id this call supplies (D17) — the parameter is never the authority.
    const crossTenant = await getPhoneNumber(other.db, { organizationId: mine.organizationId, phoneNumberId: id });
    expect(crossTenant).toBeNull();

    const ownRead = await getPhoneNumber(mine.db, { organizationId: mine.organizationId, phoneNumberId: id });
    expect(ownRead?.id).toBe(id);
  });

  it('never lets a tenant insert its own phone_numbers row directly', async () => {
    const { error } = await mine.db.from('phone_numbers').insert({
      organization_id: mine.organizationId,
      provider_resource_id: null,
      e164: '+14165551234',
      origin: 'external',
    });
    expect(error).not.toBeNull();
  });
});
