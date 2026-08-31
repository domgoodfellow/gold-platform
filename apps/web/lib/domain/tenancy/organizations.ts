import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { isCapability, type Capability } from '@/lib/domain/tenancy/capabilities';

export type Organization = {
  id: string;
  name: string;
  createdAt: string;
  /** The acting user's role here, in the tenant's own vocabulary. */
  role: string;
  /** What the acting user may do here. Read from the role, never from the UI. */
  capabilities: Capability[];
  /** The IANA zone this business thinks in. Applied at render, never stored (I9). */
  timezone: string;
  /** ISO 4217, this business's own. Never assumed by the platform (I10). */
  currency: string;
  /**
   * Minutes a resource stays occupied after work ends.
   *
   * Travel for a mobile service, cleaning for a clinic, inspection for a hire yard — the
   * reason is the tenant's and the platform does not hold one. Zero means this business has
   * said nothing, exactly as an empty operating-hours set does.
   */
  bufferMinutes: number;
  /**
   * What this business is called in a public URL, or null until it wants one.
   *
   * The platform never derives it from the name — that would be the platform naming a
   * business, and the first tenant called "Smith & Sons" would find it had opinions about
   * apostrophes.
   */
  slug: string | null;
};

const NAME_MAX = 200;

/**
 * Shared with the operator door (`platform/provision.ts`), and exported rather than copied for
 * the reason `CLAUDE.md` gives: a second caller extracts the rule, it never duplicates it. Both
 * doors onto `createOrganization` normalise identically or they are not one path (D29).
 */
export function normaliseCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DomainError(
      'A currency is a three-letter ISO 4217 code, such as EUR or GBP.',
      'organizations.currency_invalid',
    );
  }
  return currency;
}

export function normaliseName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new DomainError('An organization needs a name.', 'organizations.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'organizations.name_too_long',
    );
  }
  return name;
}

/**
 * The name given to the role that founds an organization.
 *
 * A default, not a fixture: it is a row in `roles` from the moment it is created, so a
 * tenant can rename it without a migration (D6).
 */
/** What the first membership's role is called, through either door. */
export const FOUNDING_ROLE = 'Owner';

// The embed is hinted with the constraint name because the reference is composite
// (organization_id, role_id) -> roles (organization_id, id). Naming it keeps the query
// unambiguous if a second reference to roles is ever added.
// Written as one string literal, not a concatenation: supabase-js parses the select at the
// type level and only sees a literal, so splitting it across lines collapses the result type
// to GenericStringError[].
const MEMBERSHIP_SELECT =
  'role:roles!memberships_role_same_org(name, capabilities), organization:organizations!inner(id, name, created_at, timezone, currency, buffer_minutes, slug)';

type MembershipRow = {
  role: { name: string; capabilities: string[] } | { name: string; capabilities: string[] }[];
  organization:
    | {
        id: string;
        name: string;
        created_at: string;
        timezone: string;
        currency: string;
        buffer_minutes: number;
        slug: string | null;
      }
    | {
        id: string;
        name: string;
        created_at: string;
        timezone: string;
        currency: string;
        buffer_minutes: number;
        slug: string | null;
      }[];
};

function one<T>(value: T | T[]): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toOrganization(row: MembershipRow): Organization | null {
  const organization = one(row.organization);
  const role = one(row.role);
  if (!organization || !role) return null;

  return {
    id: organization.id,
    name: organization.name,
    createdAt: organization.created_at,
    role: role.name,
    capabilities: (role.capabilities ?? []).filter(isCapability),
    timezone: organization.timezone,
    currency: organization.currency,
    bufferMinutes: organization.buffer_minutes,
    slug: organization.slug,
  };
}

/**
 * Every organization the acting user belongs to.
 *
 * There is deliberately no `.eq('organization_id', …)` here. RLS answers "which
 * organizations" through `app.current_tenant_ids()`; an application-layer filter would be a
 * second implementation of the same rule, and the one that gets forgotten
 * (constraints.md, Tenancy).
 */
export async function listMyOrganizations(db: Db): Promise<Organization[]> {
  const actor = await requireActor(db);

  // `user_id` is filtered here and this is NOT the application scoping a tenant boundary,
  // which the constraints forbid. RLS already restricts these rows to organizations the
  // caller belongs to; within those, a member legitimately sees their colleagues' rows,
  // because the people list needs them. Which of those rows is *mine* is an application
  // question, and until an organization could have a second member the answer happened to
  // be "all of them".
  const { data, error } = await db
    .from('memberships')
    .select(MEMBERSHIP_SELECT)
    .eq('user_id', actor.id);

  if (error) {
    // Same narrow reading as `getOrganization` below, for the same caller: a role that cannot
    // read the membership shape is a member of nothing, and "nothing" is a list rather than a
    // crash. Platform staff hold `select` on `memberships` and none on `roles` (D28), so the
    // embed above fails for them outright — and `/organizations` should be able to ask this
    // question of any signed-in caller without knowing which of the four shapes they are.
    if (error.code === '42501') return [];
    throw new DomainError(error.message, 'organizations.list_failed');
  }

  return (data ?? [])
    .map(toOrganization)
    .filter((organization): organization is Organization => organization !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * One organization the acting user belongs to, or null.
 *
 * Null covers both "no such organization" and "not yours", and does so without the caller
 * being able to tell them apart. RLS produces that indistinguishability for free — the row
 * simply is not in the result — and a caller that tried to distinguish them would be
 * building the leak back by hand.
 */
export async function getOrganization(db: Db, id: string): Promise<Organization | null> {
  const actor = await requireActor(db);

  // Same reason as above, and the same bug avoided: without `user_id` this returned whichever
  // membership sorted first, so in a two-person organization a member was shown a colleague's
  // role and capabilities as though they were their own. Every guard still refused the
  // operations — RLS does not consult this — but the UI would have offered them.
  const { data, error } = await db
    .from('memberships')
    .select(MEMBERSHIP_SELECT)
    .eq('organization_id', id)
    .eq('user_id', actor.id)
    .limit(1);

  if (error) {
    // **A caller whose role cannot read the membership shape at all has no membership to
    // find, and the honest answer to "is this business yours" is no rather than a crash.**
    // Platform staff are the caller this exists for: D28 grants them `select` on `memberships`
    // and none on `roles`, so the embed above fails outright for them — and a staff member who
    // types a tenant URL should get the same 404 a stranger gets. Without this,
    // `requireOrganization` turns only *null* into `notFound()` and a `permission denied`
    // reached the page as a 500.
    //
    // Narrow on purpose: `42501` is insufficient_privilege and nothing else, so every other
    // failure still surfaces. Swallowing errors generally here would hide exactly the class of
    // bug this platform relies on RLS to make loud.
    if (error.code === '42501') return null;
    throw new DomainError(error.message, 'organizations.get_failed');
  }

  const row = (data ?? [])[0];
  return row ? toOrganization(row) : null;
}

/**
 * **There is no `createOrganization` here any more, and its absence is the enforcement.**
 *
 * D29 closed founding: `create_organization` holds no grant, so this wrapper had no reachable
 * caller and a wrapper around a function nobody may execute is worse than nothing — it reads
 * like a supported path. Standing a business up is `provisionOrganization`
 * (`lib/domain/platform/provision.ts`), and the SQL function this used to call is still there,
 * ungranted, waiting for M8 to give self-serve somebody who can do the configuring.
 *
 * `normaliseName`, `normaliseCurrency` and `FOUNDING_ROLE` are exported above for that door.
 */

/**
 * Change what a business calls itself, the clock it thinks in, what it trades in, and how long
 * a resource stays busy after a job.
 *
 * All three shipped write-once, because each needed an authorization model that had no caller
 * (D19's precedent for deferring an edit path). The caller is a business that picked the
 * wrong timezone at signup and had no recourse short of a migration.
 *
 * Neither change rewrites history, and both are safe for a reason worth stating rather than
 * assuming. Every recorded amount carries the currency it was recorded in, snapshotted at
 * insert, so changing this one does not reinterpret what past jobs cost (I8). Every scheduled
 * window is an absolute instant, so changing the zone changes how it renders and not when it
 * is (I9).
 *
 * **The buffer is the one field here that does reach committed work, and it must.** A business
 * that discovers it needs forty minutes between jobs means that about tomorrow's bookings, not
 * only about the next one it takes — so every scheduled job's occupied window is recomputed.
 * Widening it far enough to overlap two committed jobs is refused by the exclusion constraint,
 * which is the database declining to hold a schedule the business cannot actually work.
 */
export async function updateOrganization(
  db: Db,
  input: {
    id: string;
    name: string;
    timezone: string;
    currency: string;
    bufferMinutes: number;
    slug: string | null;
  },
): Promise<void> {
  await requireActor(db);

  const name = normaliseName(input.name);
  const currency = normaliseCurrency(input.currency);
  const timezone = input.timezone.trim();

  if (timezone.length === 0) {
    throw new DomainError('A timezone is required.', 'organizations.timezone_required');
  }

  // Re-checked here for the message; the check constraints are the guarantee. The upper bound
  // is not a business rule — it stops a typo padding every job by a decade.
  if (
    !Number.isInteger(input.bufferMinutes) ||
    input.bufferMinutes < 0 ||
    input.bufferMinutes > 1440
  ) {
    throw new DomainError(
      'A buffer is a whole number of minutes, from zero to a day.',
      'organizations.buffer_invalid',
    );
  }

  // Re-checked for the message; the check constraint is the guarantee. Lowercased here rather
  // than rejected, because "Pneu3L" is what somebody will type and it is not a mistake.
  const slug = (input.slug ?? '').trim().toLowerCase();
  if (slug.length > 0 && !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) {
    throw new DomainError(
      'A public address is letters, numbers and hyphens — two to sixty-three characters, starting with a letter or number.',
      'organizations.slug_invalid',
    );
  }

  const { error } = await db.rpc('update_organization', {
    p_id: input.id,
    p_name: name,
    p_timezone: timezone,
    p_currency: currency,
    p_buffer_minutes: input.bufferMinutes,
    p_slug: slug,
  });

  if (error) {
    // The check against `pg_timezone_names`. The domain does not carry a list of zones —
    // that would be a second, staler answer to what Postgres already knows.
    if (error.code === '23514') {
      throw new DomainError(
        'That is not a timezone this system recognises.',
        'organizations.timezone_invalid',
      );
    }
    // Widening the buffer far enough that two committed jobs would overlap. Reachable, and
    // the right refusal: the alternative is a schedule the van cannot physically work.
    if (error.code === '23P01') {
      throw new DomainError(
        'That buffer would overlap work already scheduled on the same resource. Move that work first, or choose a shorter buffer.',
        'organizations.buffer_conflict',
      );
    }
    if (error.code === '23505') {
      throw new DomainError(
        'Another business already uses that public address.',
        'organizations.slug_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot change this organization’s settings.',
        'organizations.forbidden',
      );
    }
    throw new DomainError(error.message, 'organizations.update_failed');
  }
}
