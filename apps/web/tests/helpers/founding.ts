import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { provisionOrganization } from '@/lib/domain/platform/provision';

/**
 * How a business comes into existence, for every suite that needs one.
 *
 * **This file exists because D29 closed founding.** Until then each suite founded its own
 * tenants by calling `create_organization` as an ordinary signed-in user — twenty-nine files,
 * each with its own copy of the same five lines. That was not duplication worth fixing while
 * it was true; it became worth fixing the moment it stopped being true, because the suite's
 * idea of how a business begins now has to match the product's, and twenty-nine copies of a
 * wrong answer is twenty-nine places to correct the next time it changes.
 *
 * **A test tenant is now provisioned, exactly as a real one is.** GOLD creates it and hands it
 * to an owner who already has an account — which means every suite below this line is
 * exercising the real path rather than a fixture shortcut around it. That is the point of the
 * migration and not a side effect of it: a founding path only the tests can reach would be a
 * second creation path, which is the thing D29 says must never exist.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * One staff session per test module, made on first use.
 *
 * Vitest isolates modules per file, so this is one extra user per suite rather than one per
 * tenant. The `platform_staff` row goes in over a direct connection because **nothing in the
 * application may write it** — D28 grants no path, and `supabase/snippets/` holds the
 * same statement. It is written *before* the sign-in below, because the role claim is minted
 * at sign-in and promotion does not refresh an existing token.
 */
let staff: Promise<SupabaseClient> | null = null;

async function staffClient(): Promise<SupabaseClient> {
  staff ??= (async () => {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `gold-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;

    const pg = new Client(CONNECTION);
    await pg.connect();
    await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
      data.user.id,
      'GOLD (test)',
    ]);
    await pg.end();

    const db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await db.auth.signInWithPassword({ email, password });
    if (signIn.error) throw signIn.error;
    return db;
  })();

  return staff;
}

/**
 * Provision a business and hand it to `ownerEmail`, who must already have an account.
 *
 * Returns the organization id, which is what every caller of the old `create_organization`
 * RPC wanted from it. Everything else a suite sets up — types, statuses, resources, prices —
 * is still that suite's own business and stays where it is.
 */
export async function foundBusiness(input: {
  ownerEmail: string;
  name: string;
  currency: string;
  timezone?: string;
  displayName?: string;
}): Promise<string> {
  return provisionOrganization(await staffClient(), {
    ownerEmail: input.ownerEmail,
    name: input.name,
    currency: input.currency,
    timezone: input.timezone ?? 'UTC',
    displayName: input.displayName ?? 'Founder',
  });
}

/**
 * An account with nothing attached, for suites that need an owner to *name* but no business.
 *
 * `provision_organization` resolves the owner before it validates anything else — deliberately,
 * because "that address has no account" is the failure an operator actually hits — so a suite
 * asserting on a refused currency or an impossible timezone has to get past that step with a
 * real address first.
 */
export async function newAccountEmail(label = 'owner'): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const { error } = await admin.auth.admin.createUser({
    email,
    password: `pw-${randomUUID()}`,
    email_confirm: true,
  });
  if (error) throw error;
  return email;
}

/**
 * The staff session itself, for the handful of suites that assert on the door rather than
 * walking through it — a refused currency, a timezone Postgres will not accept.
 *
 * Exposed deliberately rather than letting those suites build their own: a second way of
 * becoming staff in this directory is a second thing to correct when the axis changes.
 */
export async function asPlatformStaff(): Promise<SupabaseClient> {
  return staffClient();
}
