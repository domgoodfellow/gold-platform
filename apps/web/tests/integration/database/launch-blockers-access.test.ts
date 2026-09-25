import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * `organization_launch_blockers` answers for one organization, and only to somebody who belongs
 * there. It is definer, so the check is its own: without it any signed-in caller — a member of
 * another business, or a booking visitor, who is `authenticated` too (D22) — could ask whether a
 * business had a module switched on with nothing behind it.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Business = { db: SupabaseClient; organizationId: string };

let pg: Client;
let staff: SupabaseClient;
let alpha: Business;
let beta: Business;

function fresh(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function newBusiness(label: string): Promise<Business> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = fresh();
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: 'EUR' });
  return { db, organizationId };
}

async function ask(db: SupabaseClient, organizationId: string) {
  return db.rpc('organization_launch_blockers', { p_id: organizationId });
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();
  alpha = await newBusiness('lb-alpha');
  beta = await newBusiness('lb-beta');
  // Public booking with no address is a real blocker, so an answer has something to leak.
  await setModuleEnabled(alpha.db, { organizationId: alpha.organizationId, key: 'booking', enabled: true });
}, 90_000);

afterAll(async () => {
  await pg.end();
});

describe('organization_launch_blockers — who may ask', () => {
  it('answers a member of the organization', async () => {
    const answer = await ask(alpha.db, alpha.organizationId);
    expect(answer.error).toBeNull();
    expect(answer.data).toEqual(['booking']);
  });

  it('answers platform staff for any organization', async () => {
    const answer = await ask(staff, alpha.organizationId);
    expect(answer.error).toBeNull();
    expect(answer.data).toEqual(['booking']);
  });

  it('refuses a member of a different business — the cross-tenant probe', async () => {
    const answer = await ask(beta.db, alpha.organizationId);
    expect(answer.error?.code).toBe('42501');
    expect(answer.data).toBeNull();
  });

  it('refuses a booking visitor who belongs to no business', async () => {
    const visitor = fresh();
    expect((await visitor.auth.signInAnonymously()).error).toBeNull();
    const answer = await ask(visitor, alpha.organizationId);
    expect(answer.error?.code).toBe('42501');
    expect(answer.data).toBeNull();
  });

  it('refuses an external actor bound to that very business — external is not membership', async () => {
    const visitor = fresh();
    const signedIn = await visitor.auth.signInAnonymously();
    expect(signedIn.error).toBeNull();
    await pg.query('insert into public.external_actors (organization_id, user_id) values ($1, $2)', [
      alpha.organizationId,
      signedIn.data.user?.id,
    ]);
    const answer = await ask(visitor, alpha.organizationId);
    expect(answer.error?.code).toBe('42501');
    expect(answer.data).toBeNull();
  });

  it('refuses a caller who is not signed in', async () => {
    const answer = await ask(fresh(), alpha.organizationId);
    expect(answer.error?.code).toBe('42501');
    expect(answer.data).toBeNull();
  });

  it('refuses a non-member identically for an organization that does not exist, so it is no oracle for existence', async () => {
    const real = await ask(beta.db, alpha.organizationId);
    const invented = await ask(beta.db, randomUUID());
    expect(invented.error?.code).toBe(real.error?.code);
    expect(invented.error?.message).toBe(real.error?.message);
  });
});

describe('the launch trigger still enforces the same answer', () => {
  it('refuses SETUP to LIVE while a blocker stands, for the owner who holds every capability', async () => {
    const refused = await alpha.db.rpc('launch_organization', { p_id: alpha.organizationId });
    expect(refused.error?.code).toBe('55000');
    expect(refused.error?.message).toContain('booking');
  });

  it('lets a business with no blocker launch', async () => {
    const launched = await beta.db.rpc('launch_organization', { p_id: beta.organizationId });
    expect(launched.error).toBeNull();
  });
});
