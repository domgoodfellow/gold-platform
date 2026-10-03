import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * A business's own sending domain, against real Postgres and real RLS.
 *
 * The half this file proves is the half no mocked test can: that the tenant may name and release
 * a domain and nothing more, that the one door which says what a provider answered is executable
 * by no signed-in role at all, that `active` cannot be written by anybody who did not ask a
 * provider, and that one business never reaches another's row by any path.
 *
 * `apps/api/tests/component/test_email_provisioning.py` holds the other half — that authorization
 * is proved before a credential is read, that every outcome is recorded before it is returned, and
 * that publishing DNS is never recorded as verification.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const PROVIDER_DOMAIN = '4dd369bc-aa82-4ff3-97de-514ae3000ee0';
const RECORDS = [
  { type: 'MX', name: 'send.acme.test', value: 'feedback-smtp.example.net', purpose: 'SPF', status: 'pending', priority: 10 },
  { type: 'TXT', name: 'resend._domainkey.acme.test', value: 'p=MIGfMA0GCSqGSIb3', purpose: 'DKIM', status: 'pending' },
];

let pg: Client;

type Tenant = { db: SupabaseClient; organizationId: string; email: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: 'EUR' });
  return { db, organizationId, email };
}

/** Acts as the one machine role that may say what a provider answered. */
async function asProviderOperator<T>(run: () => Promise<T>): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query('set local role provider_operator');
    const result = await run();
    await pg.query('commit');
    return result;
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

async function record(organizationId: string, resourceId: string, args: Record<string, unknown>) {
  return asProviderOperator(() =>
    pg.query(
      `select public.record_email_domain_provisioning($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        organizationId,
        resourceId,
        args.status ?? 'pending',
        args.providerDomainId ?? null,
        args.providerStatus ?? null,
        args.dnsRecords === undefined ? null : JSON.stringify(args.dnsRecords),
        args.errorCode ?? null,
        args.errorMessage ?? null,
      ],
    ),
  );
}

async function resource(resourceId: string) {
  const { rows } = await pg.query(
    'select status, config, last_verified_at from public.organization_provider_resources where id = $1',
    [resourceId],
  );
  return rows[0] as { status: string; config: Record<string, unknown>; last_verified_at: string | null } | undefined;
}

async function name(tenant: Tenant, domain: string): Promise<string> {
  const { data, error } = await tenant.db.rpc('record_organization_email_domain', {
    p_organization_id: tenant.organizationId,
    p_domain: domain,
  });
  if (error) throw error;
  return data as string;
}

let alice: Tenant;
let bob: Tenant;
let staff: SupabaseClient;

describe('a business proves its own sending domain', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client(DB_URL);
    await pg.connect();
    alice = await newTenant('send-alice');
    bob = await newTenant('send-bob');
    staff = await asPlatformStaff();
  });

  afterAll(async () => {
    await pg.end();
  });

  // --- naming one ---------------------------------------------------------------------------

  it('lets a business name its own sending domain, and keeps it out of another business’s sight', async () => {
    const domain = `mail-${randomUUID().slice(0, 8)}.example.test`;
    const resourceId = await name(alice, domain);
    expect(resourceId).toBeTruthy();

    const mine = await alice.db
      .from('organization_provider_resources')
      .select('external_id, status, resource_type')
      .eq('organization_id', alice.organizationId)
      .eq('external_id', domain);
    expect(mine.data).toHaveLength(1);
    expect(mine.data![0].status).toBe('pending');

    const theirs = await bob.db
      .from('organization_provider_resources')
      .select('id')
      .eq('organization_id', alice.organizationId);
    expect(theirs.data).toEqual([]);
  });

  it('records the same domain twice as one row, so pressing set-up twice is one domain', async () => {
    const domain = `mail-${randomUUID().slice(0, 8)}.example.test`;
    const first = await name(alice, domain);
    const second = await name(alice, domain);

    expect(second).toBe(first);
  });

  it('refuses a name this platform could never verify', async () => {
    for (const bad of ['', 'not a domain', 'localhost', 'http://acme.test']) {
      await expect(name(alice, bad)).rejects.toMatchObject({ code: '22023' });
    }
  });

  it('refuses a member whose role cannot manage the business', async () => {
    const { error } = await bob.db.rpc('record_organization_email_domain', {
      p_organization_id: alice.organizationId,
      p_domain: `mail-${randomUUID().slice(0, 8)}.example.test`,
    });
    expect(error?.code).toBe('42501');
  });

  // --- what the provider said is the machine role's alone ---------------------------------------

  it('is executable by no signed-in role: not the tenant, not platform staff', async () => {
    const resourceId = await name(alice, `mail-${randomUUID().slice(0, 8)}.example.test`);

    for (const [label, db] of [['the tenant', alice.db], ['platform staff', staff]] as const) {
      const { error } = await db.rpc('record_email_domain_provisioning', {
        p_organization_id: alice.organizationId,
        p_resource_id: resourceId,
        p_status: 'active',
      });
      expect(error, `${label} could call it`).not.toBeNull();
      expect(error!.message, label).toMatch(/permission denied|not find the function|schema cache/i);
    }

    expect((await resource(resourceId))!.status).toBe('pending');
  });

  it('is executable by no signed-in role for the account resolver either', async () => {
    for (const db of [alice.db, staff]) {
      const { error } = await db.rpc('email_domain_provider_account', { p_organization_id: alice.organizationId });
      expect(error).not.toBeNull();
    }
  });

  it('records the provider’s own id, status and records, and only then is the domain usable', async () => {
    const resourceId = await name(alice, `mail-${randomUUID().slice(0, 8)}.example.test`);

    await record(alice.organizationId, resourceId, {
      status: 'pending',
      providerDomainId: PROVIDER_DOMAIN,
      providerStatus: 'not_started',
      dnsRecords: RECORDS,
    });

    const pending = (await resource(resourceId))!;
    expect(pending.status).toBe('pending');
    expect(pending.last_verified_at).toBeNull();
    expect(pending.config.provider_domain_id).toBe(PROVIDER_DOMAIN);
    expect(pending.config.provider_status).toBe('not_started');
    expect(pending.config.dns_records).toHaveLength(2);

    await record(alice.organizationId, resourceId, { status: 'active', providerStatus: 'verified' });

    const ready = (await resource(resourceId))!;
    expect(ready.status).toBe('active');
    expect(ready.last_verified_at).not.toBeNull();
    // A recheck that carried no records keeps the ones registration stored.
    expect(ready.config.dns_records).toHaveLength(2);
    expect(ready.config.provider_domain_id).toBe(PROVIDER_DOMAIN);
  });

  it('clears a recorded failure the moment the provider answers without one', async () => {
    const resourceId = await name(alice, `mail-${randomUUID().slice(0, 8)}.example.test`);
    await record(alice.organizationId, resourceId, { status: 'pending', errorCode: 'provider_refused', errorMessage: 'boom' });
    expect((await resource(resourceId))!.config.last_error).toBe('boom');

    await record(alice.organizationId, resourceId, { status: 'active', providerStatus: 'verified' });

    const after = (await resource(resourceId))!;
    expect(after.config.last_error).toBeUndefined();
    expect(after.config.error_code).toBeUndefined();
  });

  it('creates nothing: a resource that was never named cannot be conjured by naming an organization', async () => {
    await expect(
      record(alice.organizationId, randomUUID(), { status: 'active' }),
    ).rejects.toThrow(/no such sending domain/);
  });

  it('refuses to write one business’s answer onto another business’s row', async () => {
    const resourceId = await name(alice, `mail-${randomUUID().slice(0, 8)}.example.test`);

    await expect(
      record(bob.organizationId, resourceId, { status: 'active' }),
    ).rejects.toThrow(/no such sending domain/);

    expect((await resource(resourceId))!.status).toBe('pending');
  });

  it('refuses a record shape nothing could publish or display', async () => {
    const resourceId = await name(alice, `mail-${randomUUID().slice(0, 8)}.example.test`);

    for (const bad of [
      [{ type: 'A', name: 'acme.test', value: '1.2.3.4' }],
      [{ type: 'TXT', name: 'acme.test', value: 'x'.repeat(2001) }],
      [{ type: 'TXT', name: 'acme.test', value: 'v=spf1', priority: 10 }],
      [{ type: 'TXT', name: '', value: 'v=spf1' }],
      Array.from({ length: 13 }, () => ({ type: 'TXT', name: 'acme.test', value: 'v=spf1' })),
    ]) {
      await expect(
        record(alice.organizationId, resourceId, { status: 'pending', dnsRecords: bad }),
      ).rejects.toThrow(/dns records/);
    }
  });

  // --- a retry after a failure ------------------------------------------------------------------

  it('returns a failed domain to pending when the business asks again, and never unverifies a verified one', async () => {
    const domain = `mail-${randomUUID().slice(0, 8)}.example.test`;
    const resourceId = await name(alice, domain);
    await record(alice.organizationId, resourceId, { status: 'failed', errorCode: 'domain_rejected', errorMessage: 'no' });

    await name(alice, domain);
    const retried = (await resource(resourceId))!;
    expect(retried.status).toBe('pending');
    expect(retried.config.last_error).toBeUndefined();

    await record(alice.organizationId, resourceId, { status: 'active', providerStatus: 'verified' });
    await name(alice, domain);
    expect((await resource(resourceId))!.status).toBe('active');
  });

  // --- letting one go -----------------------------------------------------------------------

  it('lets the business release its own sending domain, and nobody else’s', async () => {
    const resourceId = await name(alice, `mail-${randomUUID().slice(0, 8)}.example.test`);

    const theirs = await bob.db.rpc('release_organization_email_domain', {
      p_organization_id: alice.organizationId,
      p_resource_id: resourceId,
    });
    expect(theirs.error?.code).toBe('42501');
    expect(await resource(resourceId)).toBeDefined();

    const { error } = await alice.db.rpc('release_organization_email_domain', {
      p_organization_id: alice.organizationId,
      p_resource_id: resourceId,
    });
    expect(error).toBeNull();
    expect(await resource(resourceId)).toBeUndefined();
  });

  it('refuses to release a resource that is not a sending domain', async () => {
    // A phone number's id handed to this door must not delete a phone number.
    const { data: bindingId } = await staff.rpc('begin_provider_binding', {
      p_organization_id: alice.organizationId,
      p_provider_key: 'twilio',
    });
    expect(bindingId).toBeTruthy();
    const { data: numberId, error: recordError } = await staff.rpc('record_provider_resource', {
      p_organization_id: alice.organizationId,
      p_provider_key: 'twilio',
      p_resource_type: 'twilio_phone_number',
      p_external_id: `+1555${Math.floor(Math.random() * 9000000 + 1000000)}`,
      p_config: {},
      p_status: 'active',
    });
    expect(recordError).toBeNull();

    const { error } = await alice.db.rpc('release_organization_email_domain', {
      p_organization_id: alice.organizationId,
      p_resource_id: numberId as string,
    });
    expect(error?.code).toBe('22023');
    expect(await resource(numberId as string)).toBeDefined();
  });

  // --- the tenant's own read --------------------------------------------------------------------

  it('never exposes the vault reference on a sending domain, to anybody', async () => {
    const resourceId = await name(alice, `mail-${randomUUID().slice(0, 8)}.example.test`);
    void resourceId;

    for (const db of [alice.db, staff]) {
      const { error } = await db.from('organization_provider_resources').select('secret_id').limit(1);
      expect(error).not.toBeNull();
    }
  });
});
