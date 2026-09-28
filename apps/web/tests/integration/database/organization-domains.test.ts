import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * A hostname a business owns, and the address its own public name produces.
 *
 * What is provable here, against real Postgres and real RLS: a hostname is claimed once across
 * every tenant; only `provider_operator` may ever record what a hosting provider said; a domain
 * cannot become `verified` without a provider having registered a resource for it; a released
 * hostname is free again; and resolution (`hostname_binding`, `published_hostname_site`) fails
 * closed for anything but a verified, unreleased custom domain or a business's own managed slug.
 * The Vercel adapter itself is proved offline, in `apps/api/tests/contract/test_vercel_domains.py`.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ZONE = 'gildops-test.example';

let pg: Client;
let staff: SupabaseClient;

type Tenant = { db: SupabaseClient; organizationId: string };

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 8)}`, currency: 'USD' });
  return { db, organizationId };
}

async function setSlug(organizationId: string, slug: string | null) {
  await pg.query('update public.organizations set slug = $1 where id = $2', [slug, organizationId]);
}

/** Acts as the one machine role that may record what a hosting provider said. */
async function asOperator<T>(run: () => Promise<T>): Promise<T> {
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

async function registerAsOperator(domainId: string, organizationId: string, records: unknown[] = []) {
  return asOperator(async () => {
    const { rows } = await pg.query(
      `select public.record_custom_domain_registration($1, $2, 'satisfied', $3::jsonb, null, null) as resource_id`,
      [organizationId, domainId, JSON.stringify(records)],
    );
    return rows[0].resource_id as string;
  });
}

async function verifyAsOperator(domainId: string, organizationId: string) {
  await asOperator(() =>
    pg.query(
      `select public.set_custom_domain_verification($1, $2, 'verified', 'satisfied', 'issued', null, null, null)`,
      [organizationId, domainId],
    ),
  );
}

let tenant: Tenant;
let other: Tenant;

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  await pg.query('update public.platform_settings set platform_public_domain = $1 where singleton', [ZONE]);

  staff = await asPlatformStaff();
  tenant = await newTenant('domains');
  other = await newTenant('domains-other');
}, 60_000);

afterAll(async () => {
  await pg.query('update public.platform_settings set platform_public_domain = null where singleton');
  await pg?.end();
});

describe('the GildOps-managed address', () => {
  it('is the business’s own public name under the deployment’s zone, computed rather than stored', async () => {
    const slug = `shop-${randomUUID().slice(0, 8)}`;
    await setSlug(tenant.organizationId, slug);

    const { data: zone } = await tenant.db.rpc('platform_public_domain');
    expect(zone).toBe(ZONE);

    const { data } = await tenant.db.rpc('hostname_binding', { p_hostname: `${slug}.${ZONE}` });
    expect(data?.[0]).toMatchObject({ organization_id: tenant.organizationId, surface: 'website' });
  });

  it('resolves to nothing for a business with no public name yet', async () => {
    const { data } = await tenant.db.rpc('hostname_binding', { p_hostname: `no-such-slug-${randomUUID().slice(0, 8)}.${ZONE}` });
    expect(data ?? []).toHaveLength(0);
  });
});

describe('naming a custom domain', () => {
  it('lets a member with organization.manage connect a hostname, pending until a provider answers', async () => {
    const hostname = `shop-${randomUUID().slice(0, 8)}.example.test`;

    const { data: domainId, error } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });
    expect(error).toBeNull();
    expect(domainId).toBeTruthy();

    const row = await tenant.db.from('organization_domains').select('*').eq('id', domainId).single();
    expect(row.data).toMatchObject({ hostname, surface: 'website', verification_state: 'pending', is_primary: false });

    // Not yet verified: resolution fails closed even though the row exists.
    const binding = await tenant.db.rpc('hostname_binding', { p_hostname: hostname });
    expect(binding.data ?? []).toHaveLength(0);
  });

  it('refuses GildOps’ own zone — that address comes from a slug, not a claim', async () => {
    const { error } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: `anything.${ZONE}`,
      p_surface: 'website',
    });
    expect(error).not.toBeNull();
  });

  it('refuses a second claim on a hostname any unreleased row already holds — by anybody', async () => {
    const hostname = `contested-${randomUUID().slice(0, 8)}.example.test`;
    const first = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });
    expect(first.error).toBeNull();

    const second = await other.db.rpc('begin_custom_domain_connection', {
      p_organization_id: other.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });
    expect(second.error?.code).toBe('23505');

    const sameTenantAgain = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: hostname,
      p_surface: 'portal',
    });
    expect(sameTenantAgain.error?.code).toBe('23505');
  });

  it('refuses a member with no organization.manage, and refuses one business naming another’s', async () => {
    const noCapability = await other.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: `nope-${randomUUID().slice(0, 8)}.example.test`,
      p_surface: 'website',
    });
    expect(noCapability.error?.code).toBe('42501');
  });
});

describe('only provider_operator records what a hosting provider said', () => {
  it('is executable by no signed-in role, staff included', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('authenticated', 'public.record_custom_domain_registration(uuid,uuid,text,jsonb,text,text)', 'execute') as registration_authenticated,
              has_function_privilege('provider_operator', 'public.record_custom_domain_registration(uuid,uuid,text,jsonb,text,text)', 'execute') as registration_operator,
              has_function_privilege('authenticated', 'public.set_custom_domain_verification(uuid,uuid,text,text,text,jsonb,text,text)', 'execute') as verify_authenticated,
              has_function_privilege('provider_operator', 'public.set_custom_domain_verification(uuid,uuid,text,text,text,jsonb,text,text)', 'execute') as verify_operator`,
    );
    expect(rows[0]).toEqual({
      registration_authenticated: false,
      registration_operator: true,
      verify_authenticated: false,
      verify_operator: true,
    });

    const asTenant = await tenant.db.rpc('set_custom_domain_verification', {
      p_organization_id: tenant.organizationId,
      p_domain_id: randomUUID(),
      p_verification_state: 'verified',
    });
    expect(asTenant.error?.code).toBe('42501');
    const asStaff = await staff.rpc('set_custom_domain_verification', {
      p_organization_id: tenant.organizationId,
      p_domain_id: randomUUID(),
      p_verification_state: 'verified',
    });
    expect(asStaff.error?.code).toBe('42501');
  });

  it('moves a domain to verified only after a resource is registered, and resolves it once it is', async () => {
    const hostname = `verify-${randomUUID().slice(0, 8)}.example.test`;
    const { data: domainId } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });

    await registerAsOperator(domainId, tenant.organizationId, [{ type: 'CNAME', name: hostname, value: 'cname.vercel-dns.com' }]);
    const afterRegistration = await tenant.db.from('organization_domains').select('verification_state, provider_resource_id').eq('id', domainId).single();
    expect(afterRegistration.data?.verification_state).toBe('verifying');
    expect(afterRegistration.data?.provider_resource_id).toBeTruthy();

    await verifyAsOperator(domainId, tenant.organizationId);
    const verified = await tenant.db.from('organization_domains').select('verification_state, ssl_state').eq('id', domainId).single();
    expect(verified.data).toMatchObject({ verification_state: 'verified', ssl_state: 'issued' });

    const binding = await tenant.db.rpc('hostname_binding', { p_hostname: hostname });
    expect(binding.data?.[0]).toMatchObject({ organization_id: tenant.organizationId, surface: 'website' });

    const published = await tenant.db.rpc('published_hostname_site', { p_hostname: hostname });
    expect(published.data).toMatchObject({ surface: 'website' });
  });

  it('refuses to record verified on a domain the provider never registered a resource for', async () => {
    const hostname = `unregistered-${randomUUID().slice(0, 8)}.example.test`;
    const { data: domainId } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });

    await expect(verifyAsOperator(domainId, tenant.organizationId)).rejects.toThrow();
  });
});

describe('one business’s domains are out of another’s reach entirely', () => {
  it('shows nobody else’s hostnames, and refuses every write on them', async () => {
    const hostname = `mine-${randomUUID().slice(0, 8)}.example.test`;
    const { data: domainId } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });

    const cross = await other.db.from('organization_domains').select('id').eq('organization_id', tenant.organizationId);
    expect(cross.data ?? []).toEqual([]);

    const removeOthers = await other.db.rpc('release_custom_domain', {
      p_organization_id: tenant.organizationId,
      p_domain_id: domainId,
    });
    expect(removeOthers.error?.code).toBe('42501');

    const primaryOthers = await other.db.rpc('set_primary_custom_domain', {
      p_organization_id: tenant.organizationId,
      p_domain_id: domainId,
    });
    expect(primaryOthers.error?.code).toBe('42501');
  });
});

describe('releasing frees a hostname for anybody', () => {
  it('stops resolving once released, is attributed, and can be reclaimed by another business', async () => {
    const hostname = `release-${randomUUID().slice(0, 8)}.example.test`;
    const { data: domainId } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });
    await registerAsOperator(domainId, tenant.organizationId);
    await verifyAsOperator(domainId, tenant.organizationId);

    const { error } = await tenant.db.rpc('release_custom_domain', {
      p_organization_id: tenant.organizationId,
      p_domain_id: domainId,
    });
    expect(error).toBeNull();

    const released = await tenant.db.from('organization_domains').select('released_at, released_by, is_primary').eq('id', domainId).single();
    expect(released.data?.released_at).toBeTruthy();
    expect(released.data?.released_by).toBeTruthy();
    expect(released.data?.is_primary).toBe(false);

    const binding = await tenant.db.rpc('hostname_binding', { p_hostname: hostname });
    expect(binding.data ?? []).toHaveLength(0);

    const reclaimed = await other.db.rpc('begin_custom_domain_connection', {
      p_organization_id: other.organizationId,
      p_hostname: hostname,
      p_surface: 'website',
    });
    expect(reclaimed.error).toBeNull();
    expect(reclaimed.data).toBeTruthy();
  });
});

describe('a verified domain can be made primary, one per surface', () => {
  it('refuses an unverified domain, then accepts a verified one and demotes any earlier primary', async () => {
    const first = `primary-a-${randomUUID().slice(0, 8)}.example.test`;
    const second = `primary-b-${randomUUID().slice(0, 8)}.example.test`;

    const { data: firstId } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: first,
      p_surface: 'website',
    });

    const tooEarly = await tenant.db.rpc('set_primary_custom_domain', {
      p_organization_id: tenant.organizationId,
      p_domain_id: firstId,
    });
    expect(tooEarly.error).not.toBeNull();

    await registerAsOperator(firstId, tenant.organizationId);
    await verifyAsOperator(firstId, tenant.organizationId);
    const madePrimary = await tenant.db.rpc('set_primary_custom_domain', {
      p_organization_id: tenant.organizationId,
      p_domain_id: firstId,
    });
    expect(madePrimary.error).toBeNull();

    const { data: secondId } = await tenant.db.rpc('begin_custom_domain_connection', {
      p_organization_id: tenant.organizationId,
      p_hostname: second,
      p_surface: 'website',
    });
    await registerAsOperator(secondId, tenant.organizationId);
    await verifyAsOperator(secondId, tenant.organizationId);
    await tenant.db.rpc('set_primary_custom_domain', { p_organization_id: tenant.organizationId, p_domain_id: secondId });

    const rows = await tenant.db.from('organization_domains').select('id, is_primary').in('id', [firstId, secondId]);
    expect(rows.data?.find((row) => row.id === firstId)?.is_primary).toBe(false);
    expect(rows.data?.find((row) => row.id === secondId)?.is_primary).toBe(true);
  });
});
