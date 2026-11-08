import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { isCountryCode, postalCodeValid } from './regional-defaults';
import {
  ALL_CAPABILITIES,
  isCapability,
  type Capability,
} from '@/lib/domain/tenancy/capabilities';

export type Organization = {
  id: string;
  name: string;
  createdAt: string;
  /** The acting user's role here, in the tenant's own vocabulary. */
  role: string;
  /** What the acting user may do here. Read from the role, never from the UI. */
  capabilities: Capability[];
  /** The IANA zone this business thinks in. Applied at render, never stored. */
  timezone: string;
  /** Null until the business has said — never assumed. Signup doesn't ask; the pricing screen does, at the moment it's first needed. */
  currency: string | null;
  /** Minutes a resource stays occupied after work ends — travel, cleaning, inspection. The reason is the tenant's; zero means unset, same as an empty operating-hours set. */
  bufferMinutes: number;
  /** What this business is called in a public URL, or null until it wants one. Never derived from the name — that would be the platform naming a business. */
  slug: string | null;
  /** Whether this business is still being configured or is running for real. Not billing, not entitlement (the wanted-versus-paid entitlement rule remains undone) — see `lib/domain/tenancy/lifecycle.ts`. */
  operationalState: 'setup' | 'live';
};

const NAME_MAX = 200;

/** Shared with the operator door (`platform/provision.ts`) rather than duplicated — both doors normalise identically or they aren't one path. */
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
 * What the first membership's role is called, through either door — a row in `roles`,
 * renameable without a migration. `Admin`, not `Owner`: the highest ordinary organization
 * role and platform authority (`platform_staff`) are two different axes, and this is only
 * ever the tenant's own vocabulary for the first one — nothing anywhere branches on this string.
 */
export const FOUNDING_ROLE = 'Admin';

// The embed is hinted with the constraint name since the reference is composite
// (organization_id, role_id) -> roles (organization_id, id). Written as one string literal,
// not a concatenation — supabase-js parses the select at the type level and only sees a
// literal, so splitting it collapses the result type to GenericStringError[].
const MEMBERSHIP_SELECT =
  'role:roles!memberships_role_same_org(name, capabilities), organization:organizations!inner(id, name, created_at, timezone, currency, buffer_minutes, slug, operational_state)';

type MembershipRow = {
  role: { name: string; capabilities: string[] } | { name: string; capabilities: string[] }[];
  organization:
    | {
        id: string;
        name: string;
        created_at: string;
        timezone: string;
        currency: string | null;
        buffer_minutes: number;
        slug: string | null;
        // Postgres types this `text`; the check constraint is what actually narrows it to two
        // values, so the cast happens in `toOrganization` rather than being asserted here.
        operational_state: string;
      }
    | {
        id: string;
        name: string;
        created_at: string;
        timezone: string;
        currency: string | null;
        buffer_minutes: number;
        slug: string | null;
        // Postgres types this `text`; the check constraint is what actually narrows it to two
        // values, so the cast happens in `toOrganization` rather than being asserted here.
        operational_state: string;
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
    // Guaranteed to be one of the two by `organizations_operational_state_known`; the database
    // is the check constraint, not a second one written here.
    operationalState: organization.operational_state === 'live' ? 'live' : 'setup',
  };
}

/** No `.eq('organization_id', …)` — RLS already answers "which organizations" through `app.current_tenant_ids()`, and an application filter would be a second, forgettable copy of the same rule. */
export async function listMyOrganizations(db: Db): Promise<Organization[]> {
  const actor = await requireActor(db);

  // `user_id` filters *within* what RLS already restricted, not the tenant boundary itself —
  // a member legitimately sees a colleague's row in this query, since the people list needs it.
  const { data, error } = await db
    .from('memberships')
    .select(MEMBERSHIP_SELECT)
    .eq('user_id', actor.id);

  if (error) {
    // Platform staff hold `select` on `memberships` and none on `roles`, so the embed
    // fails for them outright — treated as "a member of nothing" rather than a crash.
    if (error.code === '42501') return [];
    throw fromDatabaseError(error, 'organizations.list_failed');
  }

  return (data ?? [])
    .map(toOrganization)
    .filter((organization): organization is Organization => organization !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Null covers "no such organization" and "not yours" indistinguishably — RLS produces that for free. */
export async function getOrganization(db: Db, id: string): Promise<Organization | null> {
  const actor = await requireActor(db);

  // `user_id` matters here: without it this returned whichever membership sorted first, so in
  // a two-person organization a member could be shown a colleague's role as their own. RLS
  // still refused every write regardless — but the UI would have offered them.
  const { data, error } = await db
    .from('memberships')
    .select(MEMBERSHIP_SELECT)
    .eq('organization_id', id)
    .eq('user_id', actor.id)
    .limit(1);

  if (error) {
    // Staff hold `select` on `memberships` and none on `roles`, so the embed fails for
    // them outright — a staff member typing a tenant URL should get the same 404 a stranger
    // gets, not a 500. Narrow to 42501 (insufficient_privilege) so every other failure surfaces.
    if (error.code === '42501') return null;
    throw fromDatabaseError(error, 'organizations.get_failed');
  }

  const row = (data ?? [])[0];
  return row ? toOrganization(row) : null;
}

/**
 * Found a business, as the person who will own it. Reopened after the one-creation-path rule closed the self-serve
 * door — the argument was about the quality of an unstaffed setup, and it was read as being
 * about the door's existence, leaving somebody who signs up with no way forward at all. The two
 * doors are not alternatives: `provisionOrganization` is GOLD creating a business for somebody
 * it has spoken to; this is somebody creating their own. Both call the same path and write the
 * same event — this one just can't name an owner other than the caller.
 */
export async function createOrganization(
  db: Db,
  input: {
    name: string;
    /** What this business calls the person who owns it. Theirs to change afterwards. */
    role?: string;
    /** What this person is called inside this business. Per-tenant, never a global profile. */
    displayName?: string;
    timezone: string;
    /** Optional — signup doesn't ask (the first screen is about who they are, not money). Leaving it out records that this business hasn't said (`20260904000001`); the pricing screen asks when it's first needed. `provisionOrganization` passes one because staff already know the answer. */
    currency?: string;
    /** Where the founder says the business is, written in the same transaction as the business so a retry cannot leave one without the other. */
    location?: { countryCode: string; region?: string; city?: string; postalCode?: string; industry?: string };
  },
): Promise<string> {
  await requireActor(db);

  const name = normaliseName(input.name);
  const currency = input.currency ? normaliseCurrency(input.currency) : null;
  const timezone = input.timezone.trim();

  if (timezone.length === 0) {
    throw new DomainError('A timezone is required.', 'organizations.timezone_required');
  }

  const displayName = (input.displayName ?? '').trim();

  let identity: Record<string, string> | undefined;
  if (input.location) {
    const countryCode = input.location.countryCode.trim().toUpperCase();
    if (!isCountryCode(countryCode)) {
      throw new DomainError('Choose a country from the list.', 'identity.country_invalid');
    }
    if (input.location.postalCode?.trim() && !postalCodeValid(countryCode, input.location.postalCode)) {
      throw new DomainError('That postal code does not look right for the selected country.', 'identity.postal_invalid');
    }
    identity = {
      countryCode,
      region: input.location.region?.trim() ?? '',
      city: input.location.city?.trim() ?? '',
      postalCode: input.location.postalCode?.trim() ?? '',
      industry: input.location.industry?.trim() ?? '',
    };
  }

  const { data, error } = await db.rpc('create_organization', {
    p_name: name,
    p_role: (input.role ?? FOUNDING_ROLE).trim() || FOUNDING_ROLE,
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: displayName,
    p_timezone: timezone,
    // Omitted rather than sent as null when nothing was asked, so the function's own default applies — keeps the argument type honest as optional, not nullable.
    ...(currency === null ? {} : { p_currency: currency }),
    ...(identity ? { p_identity: identity } : {}),
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot create a business from this session.',
        'organizations.forbidden',
      );
    }
    if (error.code === '23514') {
      throw new DomainError(
        'That currency or timezone is not one this platform recognises.',
        'organizations.invalid',
      );
    }
    throw fromDatabaseError(error, 'organizations.create_failed');
  }

  return data;
}

/**
 * Change what a business calls itself, the clock it thinks in, what it trades in, and how long
 * a resource stays busy after a job. Shipped write-once, then reopened once each change had a
 * caller. Currency and timezone changes are safe without rewriting history — an amount carries
 * the currency it was recorded in, and a window is an absolute instant that only renders
 * differently under a new zone. The buffer is the one field that does reach committed
 * work, because it must: widening it recomputes every scheduled job's occupied window, and the
 * exclusion constraint refuses a widen that would overlap two committed jobs.
 */
export async function updateOrganization(
  db: Db,
  input: {
    id: string;
    name: string;
    timezone: string;
    currency: string | null;
    bufferMinutes: number;
    slug: string | null;
  },
): Promise<void> {
  await requireActor(db);

  const name = normaliseName(input.name);
  const currency =
    input.currency === null
      ? null
      : normaliseCurrency(input.currency);
  const timezone = input.timezone.trim();

  if (timezone.length === 0) {
    throw new DomainError('A timezone is required.', 'organizations.timezone_required');
  }

  // Re-checked here for the message; the check constraint is the guarantee. The upper bound stops a typo padding every job by a decade.
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

  // Re-checked for the message; lowercased rather than rejected, since "Pneu3L" is a real spelling somebody will type.
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
    // Postgres function arguments accept null unless the function rejects it; generated RPC
    // types cannot express that nullability, so keep the runtime value unchanged at this boundary.
    p_currency: currency as string,
    p_buffer_minutes: input.bufferMinutes,
    p_slug: slug,
  });

  if (error) {
    // Checked against `pg_timezone_names` — the domain carries no list of zones, since that would be a second, staler answer.
    if (error.code === '23514') {
      throw new DomainError(
        'That is not a timezone this system recognises.',
        'organizations.timezone_invalid',
      );
    }
    // Widening the buffer far enough that two committed jobs would overlap — the right refusal, since the alternative is a schedule the van cannot physically work.
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
    throw fromDatabaseError(error, 'organizations.update_failed');
  }
}

/**
 * Say what this business trades in, for the first time — a narrow caller for
 * `updateOrganization`, so the answer given at the moment it's needed goes through the same
 * write path, refusal, and event as every other settings change rather than a second one that
 * forgets to record itself. Refuses to change an answer already given — that's a settings act
 * with consequences for a priced catalogue, and belongs on that screen instead.
 */
export async function setTradingCurrency(
  db: Db,
  input: { organizationId: string; currency: string },
): Promise<void> {
  const organization = await getOrganization(db, input.organizationId);
  if (!organization) {
    throw new DomainError('No such business.', 'organizations.not_found');
  }

  if (organization.currency !== null) {
    throw new DomainError(
      'This business has already said what it trades in. Change it in Settings.',
      'organizations.currency_already_set',
    );
  }

  await updateOrganization(db, {
    id: organization.id,
    name: organization.name,
    timezone: organization.timezone,
    currency: input.currency,
    bufferMinutes: organization.bufferMinutes,
    slug: organization.slug,
  });
}
