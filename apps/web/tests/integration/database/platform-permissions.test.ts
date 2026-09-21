import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { PLATFORM_CAPABILITIES, platformPermissions } from '@/lib/domain/platform/permissions';
import { platformDestinationsFor } from '@/lib/platform-navigation';

/**
 * Platform authority is not one boolean. A row in `platform_staff` says somebody runs part of GOLD,
 * and `capabilities` says which part — read live from the caller's own row, so the navigation and
 * the route guard follow the database rather than a claim in a token.
 *
 * What this proves is the row and the read. What it deliberately does **not** claim: the narrow-door
 * functions still check `platform_staff` membership only (`app.require_platform_staff()`), so a
 * limited operator is narrowed by the application's routes and navigation, not per door in the
 * database. That gap is named in `constraints.md` (D59), not hidden by a passing test.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function signedInUser(label: string): Promise<{ db: SupabaseClient; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { db, userId: data.user.id };
}

/** Written over a direct connection, as every staff row is — nothing in the application may write one (D28). */
async function makeStaff(userId: string, capabilities?: string[]) {
  const pg = new Client(CONNECTION);
  await pg.connect();
  try {
    if (capabilities) {
      await pg.query('insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)', [
        userId,
        'Operator',
        capabilities,
      ]);
    } else {
      await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [userId, 'Operator']);
    }
  } finally {
    await pg.end();
  }
}

describe('platform permissions on the staff row', () => {
  beforeAll(() => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  });

  it('gives a member of staff everything by default, so no existing operator lost a door', async () => {
    const { db, userId } = await signedInUser('perm-default');
    await makeStaff(userId);
    expect([...(await platformPermissions(db))].sort()).toEqual([...PLATFORM_CAPABILITIES].sort());
  });

  it('reads exactly the permissions a narrower row names', async () => {
    const { db, userId } = await signedInUser('perm-limited');
    await makeStaff(userId, ['platform.providers']);
    const permissions = await platformPermissions(db);
    expect([...permissions]).toEqual(['platform.providers']);
    expect(platformDestinationsFor(permissions).map((destination) => destination.key)).toEqual(['providers']);
  });

  it('reads a permission removed on the next request, not at the next sign-in', async () => {
    const { db, userId } = await signedInUser('perm-live');
    await makeStaff(userId, ['platform.providers', 'platform.health']);
    expect((await platformPermissions(db)).has('platform.health')).toBe(true);

    const pg = new Client(CONNECTION);
    await pg.connect();
    await pg.query("update public.platform_staff set capabilities = array['platform.providers'] where user_id = $1", [userId]);
    await pg.end();

    expect((await platformPermissions(db)).has('platform.health')).toBe(false);
  });

  it('is empty for somebody who is not staff — a member of GOLD holds no platform authority', async () => {
    const { db } = await signedInUser('perm-nobody');
    expect((await platformPermissions(db)).size).toBe(0);
  });

  it('refuses a permission the platform does not define', async () => {
    const { userId } = await signedInUser('perm-unknown');
    await expect(makeStaff(userId, ['platform.everything'])).rejects.toThrow(/platform_staff_capabilities_known/);
  });

  it('lets nobody edit their own row through the API — a permission is granted by hand, never self-issued', async () => {
    const { db, userId } = await signedInUser('perm-selfgrant');
    await makeStaff(userId, ['platform.health']);

    const { data, error } = await db
      .from('platform_staff')
      .update({ capabilities: [...PLATFORM_CAPABILITIES] })
      .eq('user_id', userId)
      .select();

    // No update grant exists: a privilege error, or nothing changed. Either way the row is as it was.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    expect([...(await platformPermissions(db))]).toEqual(['platform.health']);
  });

  it('shows the staff table to nobody who is not staff', async () => {
    const { db } = await signedInUser('perm-outsider');
    const { data } = await db.from('platform_staff').select('user_id');
    expect(data ?? []).toEqual([]);
  });
});
