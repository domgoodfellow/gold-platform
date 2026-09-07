import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What the people who run GOLD can see of the businesses running on it. Never asks
 * `app.has_capability` and never takes an `organizationId` — platform staff are members of
 * nothing (D28), so the boundary is the Postgres role the caller arrives in, not a role check
 * in TypeScript (I12). No `requireStaff()` for the same reason.
 */

export type Tenant = {
  id: string;
  name: string;
  createdAt: string;
  /** Rendered in it, never converted (I9). */
  timezone: string;
  /** ISO 4217. Never converted, since the console never totals across tenants (I10). */
  currency: string;
  slug: string | null;
  /** What they've switched on, alphabetical. */
  moduleKeys: string[];
  lastActivityAt: string | null;
};

/** Every column is nullable in the generated type though not in the table — a view can't declare `not null`. Narrowed below rather than asserted away. */
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
    // A tenant always has both — `create_organization` requires a currency and defaults the zone to UTC.
    timezone: row.timezone ?? 'UTC',
    currency: row.currency ?? '',
    slug: row.slug,
    moduleKeys: row.module_keys ?? [],
    lastActivityAt: row.last_activity_at,
  };
}

export type TenantPage = {
  tenants: Tenant[];
  /** How many exist — what makes a partial list say so. */
  total: number;
};

/** A screenful several times over, not a claim about how many tenants there will be. */
export const TENANT_PAGE = 200;

/**
 * A page of tenants, newest first, and how many there are. Explicit limit, total read in the
 * same round trip — PostgREST answers an unbounded select with its first thousand rows and no
 * indication that it truncated, which is worse than an honest partial list.
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

  // `count` is null when the server didn't answer with one — falling back rather than inventing a number.
  return { tenants, total: count ?? tenants.length };
}

/**
 * Whether this caller is platform staff. Asked of the database, never of a JWT claim — this
 * reads a table only the staff role may read, so the answer *is* the policy's answer. Used only
 * to choose between the console and a redirect; nothing is protected by it.
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

export type Failure = {
  /** `automation` or `message`. */
  kind: string;
  organizationId: string;
  occurredAt: string;
  /** The rule that was running, snapshotted when it ran (I8). */
  subject: string;
  /** The database's or the provider's own words, never this platform's interpretation. */
  detail: string;
};

/** Serves both staff and a member — `platform_failures` runs `security_invoker`, so staff see every business and a member sees only their own, from one query. */
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
