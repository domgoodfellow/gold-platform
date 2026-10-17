import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * A Secret Reference — a private value a business gave GildOps to use — against real Postgres.
 * What is proven here is the database half: a business sees only its own references, nothing
 * signed in (staff included) can read a value or its Vault pointer, only the machine role can
 * resolve one, rotation and disabling change what that role receives, every change leaves an
 * audit fact, and no audit fact carries a value.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SUFFIX = randomUUID().slice(0, 6).toUpperCase();
const KEY = `PARTNER_API_KEY_${SUFFIX}`;
const VALUE = `sk-live-${randomUUID()}`;
const REPLACEMENT = `sk-live-${randomUUID()}`;

type Tenant = { db: SupabaseClient; organizationId: string; userId: string };

let pg: Client;
let staff: SupabaseClient;
let alice: Tenant;
let bob: Tenant;
let secretId: string;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${SUFFIX}`, currency: 'EUR' });
  return { db, organizationId: organizationId as string, userId: created.data.user.id };
}

/** The one machine role that may read a value back. */
async function asResolver<T>(run: () => Promise<T>): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query('set local role secret_operator');
    const result = await run();
    await pg.query('commit');
    return result;
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

const resolve = (organizationId: string, key: string) =>
  asResolver(async () => (await pg.query('select public.resolve_secret_reference($1, $2) as value', [organizationId, key])).rows[0].value as string | null);

async function events(organizationId: string) {
  const { rows } = await pg.query(
    "select action, payload, actor_id from public.events where organization_id = $1 and entity_type = 'secret' order by occurred_at, id",
    [organizationId],
  );
  return rows as { action: string; payload: Record<string, string>; actor_id: string }[];
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();
  alice = await newTenant('secret-alice');
  bob = await newTenant('secret-bob');

  const created = await alice.db.rpc('create_secret_reference', {
    p_organization_id: alice.organizationId,
    p_key: KEY,
    p_label: 'Partner API',
    p_purpose: 'Called by the custom website when it books a slot',
    p_value: VALUE,
  });
  if (created.error) throw created.error;
  secretId = created.data as string;
}, 90_000);

afterAll(async () => {
  await pg.query('delete from public.secret_references where organization_id = any($1)', [[alice.organizationId, bob.organizationId]]);
  await pg.end();
});

describe('the founding administrator holds the permission', () => {
  it('names secret.manage on this business’s founding role', async () => {
    const { rows } = await pg.query(
      "select count(*) filter (where 'secret.manage' = any (capabilities)) as with_it from public.roles where organization_id = $1",
      [alice.organizationId],
    );
    expect(Number(rows[0].with_it)).toBeGreaterThan(0);
  });
});

describe('a business sees its own references and nobody else’s', () => {
  it('lists what it stored, by name, and never the value or the Vault pointer', async () => {
    const listed = await alice.db.from('secret_references').select('id, key, label, purpose, status, rotated_at, last_resolved_at');
    expect(listed.error).toBeNull();
    expect(listed.data).toHaveLength(1);
    expect(listed.data![0]).toMatchObject({ id: secretId, key: KEY, status: 'active', rotated_at: null, last_resolved_at: null });
    expect(JSON.stringify(listed.data)).not.toContain(VALUE);

    const pointer = await alice.db.from('secret_references').select('secret_id');
    expect(pointer.error?.code).toBe('42501');
    const everything = await alice.db.from('secret_references').select('*');
    expect(everything.error?.code).toBe('42501');
  });

  it('shows another business nothing — not the row, not the name', async () => {
    const seen = await bob.db.from('secret_references').select('id, key');
    expect(seen.error).toBeNull();
    expect(seen.data).toEqual([]);
  });

  it('shows platform staff nothing: staff may not reach into a business that exists', async () => {
    const seen = await staff.from('secret_references').select('id, key').eq('organization_id', alice.organizationId);
    expect(seen.data ?? []).toEqual([]);
  });

  it('shows a member without secret.manage nothing', async () => {
    const roleBefore = await pg.query(
      `select r.id, r.capabilities from public.roles r
         join public.memberships m on m.role_id = r.id
        where m.organization_id = $1 and m.user_id = $2`,
      [alice.organizationId, alice.userId],
    );
    const { id, capabilities } = roleBefore.rows[0] as { id: string; capabilities: string[] };
    await pg.query('update public.roles set capabilities = array_remove(capabilities, $2) where id = $1', [id, 'secret.manage']);
    try {
      const seen = await alice.db.from('secret_references').select('id');
      expect(seen.data).toEqual([]);
      const attempt = await alice.db.rpc('rotate_secret_reference', { p_organization_id: alice.organizationId, p_secret_id: secretId, p_value: 'nope' });
      expect(attempt.error?.code).toBe('42501');
    } finally {
      await pg.query('update public.roles set capabilities = $2 where id = $1', [id, capabilities]);
    }
  });
});

describe('nothing signed in can read a value, or write around the doors', () => {
  it('leaves the resolving door executable by no signed-in role, the owner included', async () => {
    for (const client of [alice.db, bob.db, staff, createClient(SUPABASE_URL, ANON_KEY)]) {
      const attempt = await client.rpc('resolve_secret_reference', { p_organization_id: alice.organizationId, p_key: KEY });
      expect(attempt.error?.code).toBe('42501');
      expect(attempt.data).toBeNull();
    }
  });

  it('holds no table write grant for any signed-in role', async () => {
    const insert = await alice.db.from('secret_references').insert({
      organization_id: alice.organizationId, key: 'DIRECT_WRITE', label: 'x', secret_id: randomUUID(), created_by: alice.userId,
    });
    expect(insert.error?.code).toBe('42501');
    const update = await alice.db.from('secret_references').update({ status: 'disabled' }).eq('id', secretId);
    expect(update.error?.code).toBe('42501');
    const remove = await alice.db.from('secret_references').delete().eq('id', secretId);
    expect(remove.error?.code).toBe('42501');
  });

  it('leaves Vault unreachable to every signed-in role', async () => {
    const direct = await alice.db.schema('vault' as never).from('decrypted_secrets' as never).select('*');
    expect(direct.error).not.toBeNull();
  });

  it('gives the machine role exactly one execute and no table grant', async () => {
    const tables = await pg.query("select 1 from information_schema.role_table_grants where grantee = 'secret_operator'");
    expect(tables.rowCount).toBe(0);
    const columns = await pg.query("select 1 from information_schema.column_privileges where grantee = 'secret_operator' and table_schema = 'public'");
    expect(columns.rowCount).toBe(0);
    const executes = await pg.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('secret_operator', p.oid, 'EXECUTE')
          and p.proowner <> (select oid from pg_roles where rolname = 'secret_operator')
          and p.proname in (select proname from pg_proc where prosecdef and pronamespace = 'public'::regnamespace)
          and not has_function_privilege('anon', p.oid, 'EXECUTE')
          and not has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
    );
    expect(executes.rows.map((row) => row.proname)).toEqual(['resolve_secret_reference']);
  });

  it('never wrote the value anywhere a table scan can find it', async () => {
    const { rows } = await pg.query(
      `select
         (select count(*) from public.secret_references r where r::text like '%' || $1 || '%') as in_references,
         (select count(*) from public.events e where e.payload::text like '%' || $1 || '%') as in_events,
         (select count(*) from vault.secrets s where s.secret like '%' || $1 || '%') as in_vault_plaintext`,
      [VALUE],
    );
    expect(Number(rows[0].in_references)).toBe(0);
    expect(Number(rows[0].in_events)).toBe(0);
    expect(Number(rows[0].in_vault_plaintext)).toBe(0); // encrypted at rest, not merely hidden
  });
});

describe('the machine role resolves one value by name', () => {
  it('returns the value for this business and no other, and records that it was used', async () => {
    expect(await resolve(alice.organizationId, KEY)).toBe(VALUE);
    expect(await resolve(bob.organizationId, KEY)).toBeNull(); // another business has no such name
    const listed = await alice.db.from('secret_references').select('last_resolved_at').eq('id', secretId).single();
    expect(listed.data?.last_resolved_at).not.toBeNull();
  });

  it('answers nothing for a name that was never stored', async () => {
    expect(await resolve(alice.organizationId, 'NEVER_STORED')).toBeNull();
  });
});

describe('refusing a reference at the table', () => {
  it('refuses a name a runtime would misread, an empty value and a repeated name', async () => {
    const refused = async (key: string, value: string) =>
      alice.db.rpc('create_secret_reference', { p_organization_id: alice.organizationId, p_key: key, p_label: 'x', p_purpose: '', p_value: value });

    expect((await refused('NEXT_PUBLIC_LEAKS_TO_BROWSER', 'v')).error?.code).toBe('23514');
    expect((await refused('SUPABASE_SERVICE_ROLE_KEY', 'v')).error?.code).toBe('23514');
    expect((await refused('lower_case', 'v')).error?.code).toBe('23514');
    expect((await refused(`ANOTHER_${SUFFIX}`, '   ')).error?.code).toBe('22023');
    expect((await refused(KEY, 'v')).error?.code).toBe('23505');
  });

  it('refuses a business that is not the caller’s own', async () => {
    const attempt = await alice.db.rpc('create_secret_reference', {
      p_organization_id: bob.organizationId, p_key: `INTRUDER_${SUFFIX}`, p_label: 'x', p_purpose: '', p_value: 'v',
    });
    expect(attempt.error?.code).toBe('42501');
  });
});

describe('another business cannot change this one’s reference', () => {
  it('finds nothing to rotate, disable or delete under the other business’s id', async () => {
    const rotate = await bob.db.rpc('rotate_secret_reference', { p_organization_id: bob.organizationId, p_secret_id: secretId, p_value: 'stolen' });
    expect(rotate.error?.code).toBe('22023');
    const disable = await bob.db.rpc('set_secret_reference_status', { p_organization_id: bob.organizationId, p_secret_id: secretId, p_status: 'disabled' });
    expect(disable.error?.code).toBe('22023');
    const remove = await bob.db.rpc('delete_secret_reference', { p_organization_id: bob.organizationId, p_secret_id: secretId });
    expect(remove.error?.code).toBe('22023');
    expect(await resolve(alice.organizationId, KEY)).toBe(VALUE); // untouched
  });

  it('refuses the caller’s own business id with another business’s secret id the same way', async () => {
    const attempt = await alice.db.rpc('rotate_secret_reference', { p_organization_id: bob.organizationId, p_secret_id: secretId, p_value: 'x' });
    expect(attempt.error?.code).toBe('42501'); // not a member of the business named
  });
});

describe('rotating, disabling and deleting change what the machine role receives', () => {
  it('replaces the value in place and keeps the name', async () => {
    const rotated = await alice.db.rpc('rotate_secret_reference', {
      p_organization_id: alice.organizationId, p_secret_id: secretId, p_value: REPLACEMENT, p_purpose: 'Booking confirmations',
    });
    expect(rotated.error).toBeNull();
    expect(await resolve(alice.organizationId, KEY)).toBe(REPLACEMENT);

    const listed = await alice.db.from('secret_references').select('purpose, label, rotated_at').eq('id', secretId).single();
    expect(listed.data).toMatchObject({ purpose: 'Booking confirmations', label: 'Partner API' });
    expect(listed.data?.rotated_at).not.toBeNull();
  });

  it('stops the machine role answering while disabled, and answers again once re-enabled', async () => {
    const off = await alice.db.rpc('set_secret_reference_status', { p_organization_id: alice.organizationId, p_secret_id: secretId, p_status: 'disabled' });
    expect(off.error).toBeNull();
    expect(await resolve(alice.organizationId, KEY)).toBeNull(); // whatever depends on it is not ready

    const on = await alice.db.rpc('set_secret_reference_status', { p_organization_id: alice.organizationId, p_secret_id: secretId, p_status: 'active' });
    expect(on.error).toBeNull();
    expect(await resolve(alice.organizationId, KEY)).toBe(REPLACEMENT);
  });

  it('removes the value from Vault with the row, and answers nothing afterwards', async () => {
    const before = await pg.query('select secret_id from public.secret_references where id = $1', [secretId]);
    const vaultId = before.rows[0].secret_id as string;

    const removed = await alice.db.rpc('delete_secret_reference', { p_organization_id: alice.organizationId, p_secret_id: secretId });
    expect(removed.error).toBeNull();

    expect(await resolve(alice.organizationId, KEY)).toBeNull();
    const vault = await pg.query('select 1 from vault.secrets where id = $1', [vaultId]);
    expect(vault.rowCount).toBe(0);
  });
});

describe('every change leaves an audit fact, and none carries a value', () => {
  it('records who did what to which secret and what it was for, in order', async () => {
    const trail = await events(alice.organizationId);
    expect(trail.map((event) => event.action)).toEqual([
      'secret.created', 'secret.rotated', 'secret.disabled', 'secret.enabled', 'secret.deleted',
    ]);
    for (const event of trail) {
      expect(event.actor_id).toBe(alice.userId);
      expect(event.payload).toMatchObject({ key: KEY, label: 'Partner API' });
      expect(Object.keys(event.payload).sort()).toEqual(['key', 'label', 'purpose']);
    }
    expect(trail[0]!.payload.purpose).toBe('Called by the custom website when it books a slot');
    expect(JSON.stringify(trail)).not.toContain(VALUE);
    expect(JSON.stringify(trail)).not.toContain(REPLACEMENT);
  });

  it('shows the other business none of it', async () => {
    expect(await events(bob.organizationId)).toEqual([]);
  });

  it('removes a business’s values from Vault when the business itself is deleted', async () => {
    const carol = await newTenant('secret-carol');
    const made = await carol.db.rpc('create_secret_reference', {
      p_organization_id: carol.organizationId, p_key: `CAROL_${SUFFIX}`, p_label: 'Carol', p_purpose: '', p_value: 'carol-value',
    });
    const vaultId = (await pg.query('select secret_id from public.secret_references where id = $1', [made.data])).rows[0].secret_id as string;
    await pg.query('delete from public.organizations where id = $1', [carol.organizationId]);
    expect((await pg.query('select 1 from vault.secrets where id = $1', [vaultId])).rowCount).toBe(0);
  });
});
