import type { Db } from '@/lib/db/types';
import { resolveCustom, type CustomValues } from '@/lib/domain/fields/field-definitions';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  createdAt: string;
};

const NAME_MAX = 200;

/**
 * Customers belonging to one organization.
 *
 * The `organizationId` filter here is an optimisation, not the boundary — RLS already
 * restricts the rows to organizations the caller belongs to. Passing an organization the
 * caller is not a member of returns nothing rather than raising, because that is what
 * "cannot observe" means: the row is not denied, it is not there.
 */
export async function listCustomers(
  db: Db,
  input: { organizationId: string },
): Promise<Customer[]> {
  const { data, error } = await db
    .from('customers')
    .select('id, name, email, phone, custom, created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'customers.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    // `custom` is `Json` in the generated types because that is all Postgres promises about
    // a jsonb column. A check constraint pins it to an object, and the trigger pins what may
    // be in it, so the narrowing here restates a guarantee the database already enforces.
    custom: (row.custom ?? {}) as CustomValues,
    createdAt: row.created_at,
  }));
}

export async function createCustomer(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    email?: string;
    phone?: string;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: Record<string, string>;
  },
): Promise<string> {
  await requireActor(db);

  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('A customer needs a name.', 'customers.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'customers.name_too_long',
    );
  }

  // Normalised the same way identity normalises a sign-in address, so "Ann@X.com" and
  // "ann@x.com" collide on the unique index instead of becoming two customers.
  const email = input.email?.trim().toLowerCase() || null;
  if (email !== null && !email.includes('@')) {
    throw new DomainError('That email address is not valid.', 'customers.email_invalid');
  }

  const phone = input.phone?.trim() || null;

  const custom = await resolveCustom(db, {
    organizationId: input.organizationId,
    entityType: 'customer',
    custom: input.custom,
  });

  const { data, error } = await db.rpc('create_customer', {
    p_organization_id: input.organizationId,
    p_name: name,
    // `supabase gen types` emits every function argument as non-null, because Postgres
    // records no nullability for parameters: `p_email text` accepts null and is meant to,
    // and the catalog has nowhere to say so. Generated types are authoritative for tables
    // and columns, not for function arguments (constraints.md D15). These two casts are the
    // whole of that gap in this codebase, and they assert what the migration already allows.
    p_email: email as string,
    p_phone: phone as string,
    p_custom: custom,
  });

  if (error) {
    // 23505 is the unique index doing its job. The message names the tenant-scoped rule,
    // because "duplicate key" is true and useless.
    if (error.code === '23505') {
      throw new DomainError(
        'A customer with that email already exists here.',
        'customers.email_taken',
      );
    }
    // 23514 is app.check_custom_fields refusing a payload the registry does not allow.
    // resolveCustom above catches this first for anything arriving through the domain, so
    // reaching here means the row was built somewhere that skipped it.
    if (error.code === '23514') {
      throw new DomainError(error.message, 'customers.custom_invalid');
    }
    throw new DomainError(error.message, 'customers.create_failed');
  }

  return data;
}
