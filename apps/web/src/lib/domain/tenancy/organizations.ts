import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from './actor';

export type Organization = {
  id: string;
  name: string;
  createdAt: string;
  /** The acting user's role in this organization, in the tenant's own vocabulary. */
  role: string;
};

const NAME_MAX = 200;

/**
 * The role the creator of an organization receives.
 *
 * A constant, not an enum and not a database type (D6). When a tenant wants to call this
 * something else, this becomes a lookup against that tenant's configured roles — one
 * caller, one value, in one place until then.
 */
const CREATOR_ROLE = 'owner';

/**
 * Every organization the acting user belongs to.
 *
 * There is deliberately no `.eq('organization_id', …)` here. RLS answers "which
 * organizations" through `app.current_tenant_ids()`; an application-layer filter would be a
 * second implementation of the same rule, and the one that gets forgotten
 * (constraints.md, Tenancy).
 */
export async function listMyOrganizations(db: Db): Promise<Organization[]> {
  const { data, error } = await db
    .from('memberships')
    .select('role, organization:organizations(id, name, created_at)');

  if (error) {
    throw new DomainError(error.message, 'organizations.list_failed');
  }

  return (data ?? [])
    .map((row) => {
      // PostgREST returns an embedded to-one relation as an object; supabase-js types it as
      // possibly-array without generated types, so normalise before reading.
      const organization = Array.isArray(row.organization) ? row.organization[0] : row.organization;
      if (!organization) return null;
      return {
        id: organization.id as string,
        name: organization.name as string,
        createdAt: organization.created_at as string,
        role: row.role as string,
      };
    })
    .filter((organization): organization is Organization => organization !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Create an organization and make the acting user its first member.
 *
 * The three writes — organization, membership, event — are one transaction inside
 * `public.create_organization`, because a tenant that exists with nobody in it is a row
 * nobody can ever reach again. The decision of what the creator is called stays here.
 */
export async function createOrganization(db: Db, input: { name: string }): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();

  if (name.length === 0) {
    throw new DomainError('An organization needs a name.', 'organizations.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'organizations.name_too_long',
    );
  }

  const { data, error } = await db.rpc('create_organization', {
    p_name: name,
    p_role: CREATOR_ROLE,
  });

  if (error) {
    throw new DomainError(error.message, 'organizations.create_failed');
  }

  return data as string;
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
  const { data, error } = await db
    .from('memberships')
    .select('role, organization:organizations!inner(id, name, created_at)')
    .eq('organization_id', id)
    .limit(1);

  if (error) {
    throw new DomainError(error.message, 'organizations.get_failed');
  }

  const row = (data ?? [])[0];
  if (!row) return null;

  const organization = Array.isArray(row.organization) ? row.organization[0] : row.organization;
  if (!organization) return null;

  return {
    id: organization.id as string,
    name: organization.name as string,
    createdAt: organization.created_at as string,
    role: row.role as string,
  };
}
