import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  activeSupportSession,
  endSupportSession,
  listMembersForSupport,
  startSupportSession,
} from '@/lib/domain/platform/support';
import { foundBusiness } from './helpers/founding';

/**
 * Support access, separate from membership (D28). A session is an audit trail for an action
 * staff could already take (D28 already grants `platform_staff`-equivalent reads on
 * `organizations`/`memberships` in full) — it does not widen what any table admits. What it
 * proves is narrower and just as real: *that* and *why* a staff member opened one business is
 * now a row, not a click that left no trace, and only the staff member who opened it may close
 * it early.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Actor = { db: SupabaseClient; userId: string; email: string };

async function signUp(label: string): Promise<Actor> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { db, userId: created.user.id, email };
}

async function signUpStaff(name: string): Promise<Actor> {
  const actor = await signUp('support-staff');
  const pg = new Client(CONNECTION);
  await pg.connect();
  try {
    await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
      actor.userId,
      name,
    ]);
  } finally {
    await pg.end();
  }
  return actor;
}

let staff: Actor;
let otherStaff: Actor;

/** A fresh organization per test — `activeSupportSession` deliberately answers "the most recent
 * active session for this org," so tests that end or expire one session must not share an
 * organization with a test that leaves an earlier one open. */
async function freshOrganization(): Promise<{ organizationId: string; owner: Actor }> {
  const owner = await signUp('support-member');
  const organizationId = await foundBusiness({
    ownerEmail: owner.email,
    name: `Support ${randomUUID().slice(0, 6)}`,
    displayName: 'Owner',
    currency: 'EUR',
  });
  return { organizationId, owner };
}

describe('platform support sessions', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    staff = await signUpStaff('Support One');
    otherStaff = await signUpStaff('Support Two');
  });

  it('lets staff open a support session, and nobody else', async () => {
    const { organizationId, owner: member } = await freshOrganization();
    await expect(activeSupportSession(staff.db, { organizationId })).resolves.toBeNull();

    const id = await startSupportSession(staff.db, { organizationId, reason: 'billing question' });
    expect(id).toBeTruthy();

    const active = await activeSupportSession(staff.db, { organizationId });
    expect(active?.id).toBe(id);
    expect(active?.reason).toBe('billing question');

    await expect(
      startSupportSession(member.db, { organizationId, reason: 'not staff' }),
    ).rejects.toMatchObject({ code: 'support.forbidden' });
  });

  it('reveals only the membership list, never a tenant’s own operating data', async () => {
    const { organizationId } = await freshOrganization();
    await startSupportSession(staff.db, { organizationId });
    const members = await listMembersForSupport(staff.db, { organizationId });
    expect(members.some((m) => m.displayName === 'Owner')).toBe(true);

    // Confirms this is D28's pre-existing read, not something the session widened — the session
    // is the audit trail for the click, not a new grant.
    const { data, error } = await staff.db
      .from('customers')
      .select('id')
      .eq('organization_id', organizationId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('only the staff member who started a session may end it early', async () => {
    const { organizationId } = await freshOrganization();
    const id = await startSupportSession(staff.db, { organizationId, reason: 'ownership check' });

    await endSupportSession(otherStaff.db, { id });
    let active = await activeSupportSession(staff.db, { organizationId });
    expect(active?.id).toBe(id); // untouched — otherStaff's end call silently matched no row

    await endSupportSession(staff.db, { id });
    active = await activeSupportSession(staff.db, { organizationId });
    expect(active).toBeNull();
  });

  it('lapses on its own once past expiry, without anyone ending it', async () => {
    const { organizationId } = await freshOrganization();
    const id = await startSupportSession(staff.db, { organizationId, reason: 'about to expire' });

    const pg = new Client(CONNECTION);
    await pg.connect();
    try {
      await pg.query(
        `update public.platform_support_sessions set expires_at = now() - interval '1 minute' where id = $1`,
        [id],
      );
    } finally {
      await pg.end();
    }

    const active = await activeSupportSession(staff.db, { organizationId });
    expect(active).toBeNull();
  });

  it('shows each staff member only their own session, never a colleague’s', async () => {
    // The bug this guards: the select policy deliberately admits every staff member's rows (a
    // future audit screen wants that), so `activeSupportSession` — "is there one *I* should act
    // on" — has to narrow to the caller itself. Without that, a second staff member opening the
    // same organization would see the first one's session, including its reason, and could be
    // shown UI implying they could end a session that isn't theirs.
    const { organizationId } = await freshOrganization();
    const mine = await startSupportSession(staff.db, { organizationId, reason: 'mine' });

    const asMe = await activeSupportSession(staff.db, { organizationId });
    expect(asMe?.id).toBe(mine);
    expect(asMe?.reason).toBe('mine');

    // A colleague who has opened no session of their own here sees none — not staff's.
    const asColleague = await activeSupportSession(otherStaff.db, { organizationId });
    expect(asColleague).toBeNull();

    // The colleague opens their own; each still sees only their own from here on.
    const theirs = await startSupportSession(otherStaff.db, { organizationId, reason: 'theirs' });
    expect((await activeSupportSession(staff.db, { organizationId }))?.id).toBe(mine);
    expect((await activeSupportSession(otherStaff.db, { organizationId }))?.id).toBe(theirs);
  });

  it('is invisible to the organization itself', async () => {
    const { organizationId, owner: member } = await freshOrganization();
    await startSupportSession(staff.db, { organizationId, reason: 'not the tenant’s business' });
    const { data, error } = await member.db.from('platform_support_sessions').select('id');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
