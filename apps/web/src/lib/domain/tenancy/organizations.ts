import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { ALL_CAPABILITIES, isCapability, type Capability } from './capabilities';

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
};

const NAME_MAX = 200;

function normaliseCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new DomainError(
      'A currency is a three-letter ISO 4217 code, such as EUR or GBP.',
      'organizations.currency_invalid',
    );
  }
  return currency;
}

function normaliseName(value: string): string {
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
const FOUNDING_ROLE = 'Owner';

// The embed is hinted with the constraint name because the reference is composite
// (organization_id, role_id) -> roles (organization_id, id). Naming it keeps the query
// unambiguous if a second reference to roles is ever added.
// Written as one string literal, not a concatenation: supabase-js parses the select at the
// type level and only sees a literal, so splitting it across lines collapses the result type
// to GenericStringError[].
const MEMBERSHIP_SELECT =
  'role:roles!memberships_role_same_org(name, capabilities), organization:organizations!inner(id, name, created_at, timezone, currency)';

type MembershipRow = {
  role: { name: string; capabilities: string[] } | { name: string; capabilities: string[] }[];
  organization:
    | { id: string; name: string; created_at: string; timezone: string; currency: string }
    | {
        id: string;
        name: string;
        created_at: string;
        timezone: string;
        currency: string;
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
    throw new DomainError(error.message, 'organizations.get_failed');
  }

  const row = (data ?? [])[0];
  return row ? toOrganization(row) : null;
}

/**
 * Create an organization and make the acting user its first member.
 *
 * The four writes — organization, founding role, membership, event — are one transaction
 * inside `public.create_organization`, because a tenant that exists with nobody in it is a
 * row nobody can ever reach again. What the founding role is called and what it may do stay
 * decisions of this layer.
 */
export async function createOrganization(
  db: Db,
  input: { name: string; displayName: string; timezone?: string; currency: string },
): Promise<string> {
  await requireActor(db);

  const name = normaliseName(input.name);

  // The founder names themselves here rather than being called "Member": this is the same
  // per-tenant display name every other membership carries (D19), and the organization's
  // first person is not a special case.
  const displayName = input.displayName.trim();
  if (displayName.length === 0) {
    throw new DomainError('Your name is required.', 'organizations.display_name_required');
  }

  const currency = normaliseCurrency(input.currency);

  const { data, error } = await db.rpc('create_organization', {
    p_name: name,
    p_role: FOUNDING_ROLE,
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: displayName,
    // The zone the business thinks in, chosen once at founding. There is no edit path yet
    // and that is deliberate: changing it needs a settings screen and a capability of its
    // own, and both wait for a caller. UTC is the honest default rather than the server's
    // zone, which would make the answer depend on where this happened to be deployed.
    p_timezone: (input.timezone || 'UTC') as string,
    // Required, unlike the timezone. UTC is the absence of an assumption about a business;
    // there is no neutral currency, so the platform never picks one (constraints.md:
    // "Currency is per-tenant configuration and is never assumed").
    p_currency: currency,
  });

  if (error) {
    throw new DomainError(error.message, 'organizations.create_failed');
  }

  return data;
}

/**
 * Change what a business calls itself, the clock it thinks in, and the currency it trades in.
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
 */
export async function updateOrganization(
  db: Db,
  input: { id: string; name: string; timezone: string; currency: string },
): Promise<void> {
  await requireActor(db);

  const name = normaliseName(input.name);
  const currency = normaliseCurrency(input.currency);
  const timezone = input.timezone.trim();

  if (timezone.length === 0) {
    throw new DomainError('A timezone is required.', 'organizations.timezone_required');
  }

  const { error } = await db.rpc('update_organization', {
    p_id: input.id,
    p_name: name,
    p_timezone: timezone,
    p_currency: currency,
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
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot change this organization’s settings.',
        'organizations.forbidden',
      );
    }
    throw new DomainError(error.message, 'organizations.update_failed');
  }
}
