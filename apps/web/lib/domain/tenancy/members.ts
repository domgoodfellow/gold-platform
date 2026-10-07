import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';
import { isCapability, type Capability } from './capabilities';

export type Member = {
  id: string;
  userId: string;
  /** What this organization calls this person. Per-tenant, never a global profile (D19). */
  displayName: string;
  role: { id: string; name: string; capabilities: Capability[] };
  createdAt: string;
};

const DISPLAY_NAME_MAX = 120;

// One string literal — supabase-js parses the select at the type level. Hinted with the
// constraint name because the reference to roles is composite.
const MEMBER_SELECT =
  'id, user_id, display_name, created_at, role:roles!memberships_role_same_org (id, name, capabilities)';

function one<T>(value: T | T[] | null): T | undefined {
  if (value === null) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

/** Members and roles visible under organization RLS, with only their resolved public names. */
export async function listMembers(
  db: Db,
  input: { organizationId: string },
): Promise<Member[]> {
  const { data, error } = await db
    .from('memberships')
    .select(MEMBER_SELECT)
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'members.list_failed');
  }

  const names = await memberDisplayNames(db, input.organizationId);
  return (data ?? []).flatMap((row) => {
    const role = one(row.role);
    // A membership without a role cannot exist — role_id is NOT NULL behind a composite
    // foreign key — so this is unreachable rather than defensive.
    if (!role) return [];

    return [
      {
        id: row.id,
        userId: row.user_id,
        displayName: names.get(row.id) ?? row.display_name ?? 'Member',
        role: {
          id: role.id,
          name: role.name,
          capabilities: role.capabilities.filter(isCapability),
        },
        createdAt: row.created_at,
      },
    ];
  });
}

/**
 * Add someone who already has an account to this organization.
 *
 * Deliberately not an invitation system. D19: adding a person is a `memberships` row against
 * an existing `auth.users` id, and emailing a stranger to create an account is a different
 * feature with different questions. Someone without an account signs up first.
 *
 * Whether the caller may is decided inside `add_member_by_email`, not here — the function is
 * SECURITY DEFINER because `auth.users` is unreadable under the caller's own rights, so it
 * re-asserts `role.manage` itself rather than relying on RLS that it has bypassed.
 */
export async function addMember(
  db: Db,
  input: {
    organizationId: string;
    email: string;
    displayName?: string;
    roleId: string;
  },
): Promise<string> {
  await requireActor(db);

  const email = input.email.trim().toLowerCase();
  if (email.length === 0) {
    throw new DomainError('An email address is required.', 'members.email_required');
  }
  if (!email.includes('@')) {
    throw new DomainError('That email address is not valid.', 'members.email_invalid');
  }

  const displayName = (input.displayName ?? '').trim();
  if (displayName.length > DISPLAY_NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${DISPLAY_NAME_MAX} characters.`,
      'members.name_too_long',
    );
  }

  if (!input.roleId) {
    throw new DomainError('A role is required.', 'members.role_required');
  }

  const { data, error } = await db.rpc('add_member_by_email', {
    p_organization_id: input.organizationId,
    p_email: email,
    p_display_name: displayName,
    p_role_id: input.roleId,
  });

  if (error) {
    if (error.code === 'P0002') {
      throw new DomainError(
        'Nobody with that address has an account yet. Ask them to sign up first.',
        'members.no_account',
      );
    }
    if (error.code === '23505') {
      throw new DomainError('They are already a member here.', 'members.already_member');
    }
    // A composite foreign key refusing a role that belongs to another organization. From
    // this caller's position that role does not exist.
    if (error.code === '23503') {
      throw new DomainError('No such role here.', 'members.role_not_found');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot manage people here.', 'members.forbidden');
    }
    throw new DomainError(error.message, 'members.add_failed');
  }

  return data;
}

/** A colleague sees only the resolved public name, not another account's private profile. */
export async function memberDisplayNames(db: Db, organizationId: string): Promise<Map<string, string>> {
  const { data, error } = await db.rpc('member_display_names', { p_organization_id: organizationId });
  if (error) throw new DomainError('Unable to load member names.', 'members.names_failed');
  return new Map((data ?? []).map((row) => [row.membership_id, row.display_name]));
}
