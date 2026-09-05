import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What the people who run GOLD can see of the businesses running on it.
 *
 * **This module never asks `app.has_capability` and never takes an `organizationId`**, and
 * both absences are the axis rather than an omission. Every other domain module answers *what
 * may this member do inside this business*; there is no role here to ask about, because
 * platform staff are members of nothing (D28). The boundary is the Postgres role the caller
 * arrives in and the policies keyed to it — so a caller who is not staff gets an empty list
 * from the same code, rather than a different code path that decides.
 *
 * That is why there is no `requireStaff()` below. A guard in TypeScript that decided who is
 * staff would be a second authorization system sitting in front of the real one, and I12 says
 * plainly that is not authorization. `requireActor` is here for the same reason it is
 * everywhere else: to turn "no session" into a sentence rather than an empty screen.
 */

export type Tenant = {
  id: string;
  name: string;
  createdAt: string;
  /** The zone this business thinks in. Rendered in it, never converted (I9). */
  timezone: string;
  /** ISO 4217, theirs. The console never totals across tenants, so it never converts (I10). */
  currency: string;
  /** Their public slug, or null if they have never wanted one. */
  slug: string | null;
  /** What they have switched on, alphabetical. */
  moduleKeys: string[];
  /** When anything last happened here, or null for a business that has done nothing. */
  lastActivityAt: string | null;
};

/**
 * The view's row as Postgres describes it.
 *
 * Every column is nullable and none of them is: `id` and `name` are `not null` on
 * `organizations`, but a view cannot declare that, so the generated types widen. Narrowed
 * below rather than asserted away — `toTenant` returns null for a row it cannot read, which is
 * the same shape `organizations.ts` uses for an embed that came back empty.
 */
type TenantRow = {
  id: string | null;
  name: string | null;
  created_at: string | null;
  timezone: string | null;
  currency: string | null;
  slug: string | null;
  module_keys: string[] | null;
  last_activity_at: string | null;
};

function toTenant(row: TenantRow): Tenant | null {
  if (!row.id || !row.name || !row.created_at) return null;

  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    // A tenant always has both — `create_organization` requires a currency and defaults the
    // zone to UTC — so these coalesce to what the database would have stored rather than to a
    // placeholder that would read as a real answer on screen.
    timezone: row.timezone ?? 'UTC',
    currency: row.currency ?? '',
    slug: row.slug,
    moduleKeys: row.module_keys ?? [],
    lastActivityAt: row.last_activity_at,
  };
}

/** One page of the console, and the number the page is a page of. */
export type TenantPage = {
  tenants: Tenant[];
  /** How many exist, which is what makes a partial list say so. */
  total: number;
};

/**
 * How many tenants the console draws at once.
 *
 * A number this file chooses rather than one PostgREST imposes — see below. Two hundred is a
 * screenful several times over and is not a claim about how many tenants there will be.
 */
export const TENANT_PAGE = 200;

/**
 * A page of tenants, newest first, and how many there are.
 *
 * **This used to say "no pagination, deliberately", and the trigger it named has fired — as
 * something worse than the one it predicted.** That note said a `limit` before anything scrolls
 * is an abstraction with no caller, and that the trigger would be "the first time this screen is
 * slow, which is a fact rather than a guess". The fact arrived in a different shape: PostgREST
 * answers an unbounded select with its **first thousand rows and no indication that it did**, so
 * the console was never unpaginated — it had a page size nobody chose, no way to reach the next
 * one, and a silent cliff. Ordered newest-first, what it dropped was the oldest tenants, which is
 * the half of the list somebody chasing a lapsed business would be looking for.
 *
 * So the limit is explicit and the total is read in the same round trip, because a truncated list
 * that says so is honest and one that does not is a lie about what this business has. The
 * remedy for *more than a page* is a filter or a next page, and neither has a caller yet — what
 * this change buys is that the console can now tell somebody they need one.
 */
export async function listTenants(
  db: Db,
  options: { limit?: number } = {},
): Promise<TenantPage> {
  await requireActor(db);

  const limit = options.limit ?? TENANT_PAGE;

  const { data, error, count } = await db
    .from('platform_tenants')
    .select('id, name, created_at, timezone, currency, slug, module_keys, last_activity_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new DomainError(error.message, 'platform.tenants_failed');
  }

  const tenants = (data ?? [])
    .map(toTenant)
    .filter((tenant): tenant is Tenant => tenant !== null);

  // `count` is null when the server did not answer with one. Falling back to what came back
  // means the page says "these are all of them", which is the reading that does not invent a
  // number — and it is the same answer the old code gave in every case.
  return { tenants, total: count ?? tenants.length };
}

/**
 * Whether this caller is platform staff.
 *
 * **Asked of the database, never of the session.** The role lives in a JWT claim and reading
 * it here would be the application deciding — the same shape I12 refuses. Instead this reads a
 * table only the staff role may read, so the answer *is* the policy's answer. A tenant gets
 * `permission denied`, which is not an error worth surfacing: it is the correct negative.
 *
 * It is used to choose between the console and a redirect, which is convenience exactly as
 * `proxy.ts` is convenience. Nothing is protected by it — the console shows what the caller's
 * role can read, and for a member that is their own organizations and nothing else.
 */
export async function isPlatformStaff(db: Db): Promise<boolean> {
  const { data } = await db.auth.getUser();
  if (!data.user) return false;

  const { data: rows } = await db
    .from('platform_staff')
    .select('user_id')
    .eq('user_id', data.user.id);

  return (rows ?? []).length > 0;
}

/**
 * What is failing, across every tenant this caller can see.
 *
 * **The fourth of M5's four questions, arriving with the writer that made it answerable.** That
 * milestone could say who exists, what they had switched on and when they last did anything, and
 * not this — because nothing in the schema recorded a failure. An automation is the first thing
 * this platform does that fails with nobody watching, and `automation_runs` and
 * `message_deliveries` are where it says so.
 *
 * **The same function serves both readers**, and that is the point rather than a saving.
 * `platform_failures` runs `security_invoker`, so staff see every business and a member sees
 * their own — one query, one shape, and no second idea of what "failing" means growing on the
 * tenant's side of the product.
 */
export type Failure = {
  /** `automation` or `message`. Two sources, one question. */
  kind: string;
  organizationId: string;
  occurredAt: string;
  /** The rule that was running, snapshotted when it ran (I8). */
  subject: string;
  /** The database's or the provider's own words. Never this platform's interpretation. */
  detail: string;
};

export async function listFailures(
  db: Db,
  input: { limit?: number } = {},
): Promise<Failure[]> {
  await requireActor(db);

  const { data, error } = await db
    .from('platform_failures')
    .select('kind, organization_id, occurred_at, subject, detail')
    .order('occurred_at', { ascending: false })
    .limit(input.limit ?? 50);

  if (error) {
    throw new DomainError(error.message, 'platform.failures_failed');
  }

  return (data ?? [])
    .filter((row) => row.kind && row.organization_id && row.occurred_at)
    .map((row) => ({
      kind: row.kind as string,
      organizationId: row.organization_id as string,
      occurredAt: row.occurred_at as string,
      subject: (row.subject as string | null) ?? '',
      detail: (row.detail as string | null) ?? '',
    }));
}
