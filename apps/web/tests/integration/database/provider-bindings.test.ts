import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  beginProviderBinding,
  getProviderBinding,
  listProviderBindings,
  listProviderResources,
  recordOrganizationEmailDomain,
  recordProviderResource,
  setProviderBindingStatus,
  setProviderResourceStatus,
  storeProviderSecret,
} from '@/lib/domain/providers/bindings';
import { setCallingNumber } from '@/lib/domain/reception/telephony';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Which external provider scope belongs to an organization, and where a generated secret lives.
 *
 * **The write door, not the wiring behind it.** `provisionTelephonySubaccount` calls a real
 * Twilio-shaped REST API this environment has no credential for, so what is provable here is
 * exactly what section 10 actually asks for: the narrow functions it is built from, in isolation
 * — their idempotency, their tenant isolation, and that nothing ever hands a secret back.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pg: Client;
let staff: SupabaseClient;

type Tenant = { db: SupabaseClient; organizationId: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} ${randomUUID().slice(0, 8)}`,
    currency: 'USD',
  });

  return { db, organizationId };
}

let tenant: Tenant;
let other: Tenant;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  }

  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  staff = await asPlatformStaff();
  tenant = await newTenant('providers');
  other = await newTenant('providers-other');
}, 60_000);

afterAll(async () => {
  await pg?.end();
});

describe('provider bindings and resources', () => {
  it('lets staff begin a binding, record a resource and read both back — never a tenant writing either', async () => {
    const bindingId = await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
    expect(bindingId).toBeTruthy();

    const resourceId = await recordProviderResource(staff, {
      organizationId: tenant.organizationId,
      providerKey: 'twilio',
      resourceType: 'twilio_subaccount',
      externalId: `AC${randomUUID().replace(/-/g, '')}`,
    });
    expect(resourceId).toBeTruthy();

    await setProviderBindingStatus(staff, {
      organizationId: tenant.organizationId,
      providerKey: 'twilio',
      status: 'active',
    });

    const binding = await getProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
    expect(binding?.status).toBe('active');

    const resources = await listProviderResources(tenant.db, { organizationId: tenant.organizationId });
    expect(resources.some((resource) => resource.id === resourceId)).toBe(true);

    // The narrow operation is the only door: a tenant may not begin its own binding, and staff
    // has no broad grant either — both refusals are the point.
    await expect(
      beginProviderBinding(tenant.db, { organizationId: tenant.organizationId, providerKey: 'resend' }),
    ).rejects.toThrow();

    const staffTableWrite = await staff
      .from('organization_provider_bindings')
      .insert({ organization_id: tenant.organizationId, provider_key: 'resend' })
      .select('id');
    expect(staffTableWrite.data ?? []).toEqual([]);

    const tenantTableWrite = await tenant.db
      .from('organization_provider_resources')
      .insert({
        organization_id: tenant.organizationId,
        binding_id: bindingId,
        resource_type: 'twilio_phone_number',
        external_id: '+14165550199',
      })
      .select('id');
    expect(tenantTableWrite.data ?? []).toEqual([]);
  });

  it("keeps one organization's bindings and resources out of another's reach entirely", async () => {
    await beginProviderBinding(staff, { organizationId: other.organizationId, providerKey: 'twilio' });
    await recordProviderResource(staff, {
      organizationId: other.organizationId,
      providerKey: 'twilio',
      resourceType: 'twilio_subaccount',
      externalId: `AC${randomUUID().replace(/-/g, '')}`,
    });

    const crossBindings = await listProviderBindings(tenant.db, { organizationId: other.organizationId });
    expect(crossBindings).toHaveLength(0);

    const crossResources = await listProviderResources(tenant.db, { organizationId: other.organizationId });
    expect(crossResources).toHaveLength(0);

    // Reading through the raw table agrees with the domain reader — the refusal is RLS, not a
    // filtered query this file could get wrong.
    const raw = await tenant.db
      .from('organization_provider_bindings')
      .select('id')
      .eq('organization_id', other.organizationId);
    expect(raw.data ?? []).toEqual([]);
  });

  it('is idempotent: retrying begin/record does not duplicate a logical binding or resource', async () => {
    const label = `idempotent-${randomUUID().slice(0, 8)}`;
    const externalId = `AC${randomUUID().replace(/-/g, '')}`;

    const first = await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
    const second = await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
    expect(second).toBe(first);

    const firstResource = await recordProviderResource(staff, {
      organizationId: tenant.organizationId,
      providerKey: 'twilio',
      resourceType: 'twilio_twiml_app',
      externalId,
      config: { note: label, attempt: 1 },
    });
    const secondResource = await recordProviderResource(staff, {
      organizationId: tenant.organizationId,
      providerKey: 'twilio',
      resourceType: 'twilio_twiml_app',
      externalId,
      config: { note: label, attempt: 2 },
    });
    expect(secondResource).toBe(firstResource);

    const { rows } = await pg.query(
      `select count(*)::int as count from public.organization_provider_resources
        where organization_id = $1 and resource_type = 'twilio_twiml_app' and external_id = $2`,
      [tenant.organizationId, externalId],
    );
    expect(rows[0].count).toBe(1);

    const bindingRows = await pg.query(
      `select count(*)::int as count from public.organization_provider_bindings
        where organization_id = $1 and provider_key = 'twilio'`,
      [tenant.organizationId],
    );
    expect(bindingRows.rows[0].count).toBe(1);
  });

  it('records a failed provisioning attempt as durable state, not only a thrown error', async () => {
    await beginProviderBinding(staff, { organizationId: other.organizationId, providerKey: 'resend' });
    await setProviderBindingStatus(staff, {
      organizationId: other.organizationId,
      providerKey: 'resend',
      status: 'failed',
      error: 'the sending domain could not be verified',
    });

    const binding = await getProviderBinding(staff, { organizationId: other.organizationId, providerKey: 'resend' });
    expect(binding?.status).toBe('failed');
    expect(binding?.lastError).toBe('the sending domain could not be verified');

    // Resuming (a retry) moves it back to provisioning rather than leaving the failure the
    // permanent last word.
    const resumed = await beginProviderBinding(staff, { organizationId: other.organizationId, providerKey: 'resend' });
    const afterResume = await getProviderBinding(staff, { organizationId: other.organizationId, providerKey: 'resend' });
    expect(afterResume?.id).toBe(resumed);
    expect(afterResume?.status).toBe('provisioning');
  });
});

describe('a generated secret is written, never read back', () => {
  it('stores a secret and returns only the resource id — never the secret, to staff or to anyone', async () => {
    await beginProviderBinding(staff, { organizationId: tenant.organizationId, providerKey: 'twilio' });
    const resourceId = await recordProviderResource(staff, {
      organizationId: tenant.organizationId,
      providerKey: 'twilio',
      resourceType: 'twilio_api_key',
      externalId: `SK${randomUUID().replace(/-/g, '')}`,
    });

    const { data, error } = await staff.rpc('store_provider_secret', {
      p_organization_id: tenant.organizationId,
      p_resource_id: resourceId,
      p_secret: 'a-generated-api-key-secret-nobody-should-see-again',
    });
    expect(error).toBeNull();
    // The one thing this function may ever return.
    expect(data).toBe(resourceId);
    expect(String(data)).not.toContain('a-generated-api-key-secret-nobody-should-see-again');

    // Rotation reuses the same vault row rather than minting a second live secret.
    const rotated = await storeProviderSecret(staff, {
      organizationId: tenant.organizationId,
      resourceId,
      secret: 'a-rotated-secret',
    });
    expect(rotated).toBeUndefined();
  });

  it('grants nobody — not a tenant, not staff — any way to select a decrypted vault secret', async () => {
    // The actual security boundary: `authenticated` holds no grant on either vault table at all,
    // so there is no query — through PostgREST or otherwise — that could ever return one.
    // `platform_staff` stopped being a Postgres role under 20260915000001 (staff are
    // `authenticated` now, recognised by a table read rather than a role), so there is no second
    // role left to check here — checking `authenticated` alone covers staff and tenant both.
    const { rows } = await pg.query(
      `select has_table_privilege('authenticated', 'vault.secrets', 'select') as secrets,
              has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select') as decrypted`,
    );
    expect(rows[0].secrets).toBe(false);
    expect(rows[0].decrypted).toBe(false);

    // Nor is `secret_id` itself reachable through the resource row, for either role.
    const resources = await listProviderResources(staff, { organizationId: tenant.organizationId });
    const withKey = resources.find((resource) => resource.resourceType === 'twilio_api_key');
    expect(withKey).toBeTruthy();
    expect((withKey as unknown as { secretId?: unknown }).secretId).toBeUndefined();

    const raw = await staff
      .from('organization_provider_resources')
      .select('secret_id' as never)
      .eq('id', withKey!.id);
    expect(raw.error).toBeTruthy();
  });
});

/** A fresh E.164 number per call, so a leftover row from an earlier run of this suite (no
 * `db:reset` in between) can never collide with this run's own fixture — the same reason every
 * other tenant/label in this repository's tests carries a `randomUUID()` suffix. */
function freshNumber(): string {
  const digits = randomUUID().replace(/[^0-9]/g, '').padEnd(9, '0').slice(0, 9);
  return `+1${digits}`;
}

describe("a tenant configures only what is already bound to it", () => {
  it("cannot select another organization's phone number as its own outbound identity", async () => {
    const contestedNumber = freshNumber();

    await beginProviderBinding(staff, { organizationId: other.organizationId, providerKey: 'twilio' });
    await recordProviderResource(staff, {
      organizationId: other.organizationId,
      providerKey: 'twilio',
      resourceType: 'twilio_phone_number',
      externalId: contestedNumber,
    });

    await expect(
      setCallingNumber(tenant.db, { organizationId: tenant.organizationId, number: contestedNumber }),
    ).rejects.toThrow();

    // The rightful owner may still choose it.
    await setCallingNumber(other.db, { organizationId: other.organizationId, number: contestedNumber });

    // A number nobody has ever bound to anybody stays exactly as free-text-settable as before
    // this slice — most businesses on this deployment have provisioned nothing yet.
    await setCallingNumber(tenant.db, { organizationId: tenant.organizationId, number: freshNumber() });
  });

  it("lets a business name its own sending domain, and keeps one business's domain out of another's list", async () => {
    const domain = `mail-${randomUUID().slice(0, 8)}.example.test`;
    const resourceId = await recordOrganizationEmailDomain(tenant.db, {
      organizationId: tenant.organizationId,
      domain,
    });
    expect(resourceId).toBeTruthy();

    const mine = await listProviderResources(tenant.db, { organizationId: tenant.organizationId, providerKey: 'resend' });
    expect(mine.some((resource) => resource.externalId === domain)).toBe(true);

    const othersView = await listProviderResources(other.db, { organizationId: tenant.organizationId });
    expect(othersView).toHaveLength(0);

    // Verification is staff's own narrow door, not the tenant's.
    await expect(
      setProviderResourceStatus(tenant.db, { organizationId: tenant.organizationId, resourceId, status: 'active' }),
    ).rejects.toThrow();

    await setProviderResourceStatus(staff, { organizationId: tenant.organizationId, resourceId, status: 'active' });
    const verified = await listProviderResources(tenant.db, { organizationId: tenant.organizationId, providerKey: 'resend' });
    expect(verified.find((resource) => resource.id === resourceId)?.status).toBe('active');
  });
});

describe('telephony resolution is organization-aware', () => {
  it("addresses a business's own subaccount when one is bound, and GOLD's master scope when none is", async () => {
    const { twilioTelephony } = await import('@/lib/adapters/telephony/twilio');

    const calls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ call_sid: 'CA123', status: 'queued' }), { status: 201 });
    });

    try {
      const master = twilioTelephony({
        account: 'ACMASTER',
        token: 'tok',
        apiKeySid: 'SK1',
        apiKeySecret: 'secret',
        appSid: 'AP1',
      });
      await master.addToRoom({ room: 'gold-1', from: '+14165550100', to: '+14165550101', reportTo: 'https://example.test' });
      expect(calls[0]).toContain('/Accounts/ACMASTER/');

      const scoped = twilioTelephony({
        account: 'ACMASTER',
        token: 'tok',
        apiKeySid: 'SK1',
        apiKeySecret: 'secret',
        appSid: 'AP1',
        actingAccountSid: 'ACSUBACCOUNT',
      });
      await scoped.addToRoom({ room: 'gold-2', from: '+14165550100', to: '+14165550101', reportTo: 'https://example.test' });
      expect(calls[1]).toContain('/Accounts/ACSUBACCOUNT/');
      expect(calls[1]).not.toContain('/Accounts/ACMASTER/');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
