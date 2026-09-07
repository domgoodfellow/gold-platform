import type { Db } from '@/lib/db/types';
import {
  resolveCustom,
  type CustomInput,
  type CustomValues,
} from '@/lib/domain/fields/field-definitions';
import { DomainError } from '@/lib/domain/errors';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import { requireActor } from '@/lib/domain/tenancy/actor';

export type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Tenant-defined fields, governed by this organization's registry (D7). */
  custom: CustomValues;
  /**
   * Where this relationship has got to, or null.
   *
   * Null for a business that has named no stages, and for a customer nobody has staged yet.
   * Both are ordinary: the platform seeds no pipeline, so an absent stage means this business
   * has said nothing rather than that something is missing.
   */
  stageId: string | null;
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
  input: { organizationId: string; limit?: number },
): Promise<Counted<Customer>> {
  const { data, error, count } = await db
    .from('customers')
    .select('id, name, email, phone, custom, stage_id, created_at', { count: 'exact' })
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'customers.list_failed');
  }

  return counted(
    (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      // `custom` is `Json` in the generated types because that is all Postgres promises about
      // a jsonb column. A check constraint pins it to an object, and the trigger pins what may
      // be in it, so the narrowing here restates a guarantee the database already enforces.
      custom: (row.custom ?? {}) as CustomValues,
      stageId: row.stage_id,
      createdAt: row.created_at,
    })),
    count,
  );
}

export async function createCustomer(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    email?: string;
    phone?: string;
    /** Raw form values keyed by field key. Coerced and checked against the registry here. */
    custom?: CustomInput;
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

/**
 * One customer, or null.
 *
 * Null covers both "no such customer" and "not yours" without the caller being able to tell
 * them apart — RLS produces that indistinguishability for free, and a caller that tried to
 * distinguish them would be rebuilding the leak by hand.
 */
export async function getCustomer(
  db: Db,
  input: { organizationId: string; customerId: string },
): Promise<Customer | null> {
  const { data, error } = await db
    .from('customers')
    .select('id, name, email, phone, custom, stage_id, created_at')
    .eq('organization_id', input.organizationId)
    .eq('id', input.customerId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'customers.get_failed');
  }
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    phone: data.phone,
    custom: (data.custom ?? {}) as CustomValues,
    stageId: data.stage_id,
    createdAt: data.created_at,
  };
}

/**
 * Correct a customer, and move them along.
 *
 * **The path this repository went eight milestones without**, which nothing noticed because the
 * businesses built here create a customer and then work on their jobs. A business that works the
 * *customer* rather than the job — anybody selling — finds it on the first afternoon: a typo in a
 * phone number was permanent, and a relationship could not be moved anywhere because there was
 * nowhere to move it to.
 *
 * **Every field is the new value, including the ones that did not change.** A partial update
 * needs a way to say *leave this alone* that a screen cannot distinguish from *set this to
 * null*, and what a form has is a whole record. `update_customer` writes the row, validates the
 * custom payload against the registry and records the events, so no caller can do two of the
 * three.
 */
export async function updateCustomer(
  db: Db,
  input: {
    organizationId: string;
    customerId: string;
    name: string;
    email?: string;
    phone?: string;
    custom?: CustomInput;
    stageId?: string | null;
  },
): Promise<void> {
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

  // Normalised exactly as creation normalises it, so an address edited into a different case is
  // the same address rather than a second customer.
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

  const { error } = await db.rpc('update_customer', {
    p_organization_id: input.organizationId,
    p_customer_id: input.customerId,
    p_name: name,
    // The same two casts `createCustomer` carries, and the same reason: Postgres records no
    // nullability for function parameters, so the generated types cannot express one (D15).
    p_email: email as string,
    p_phone: phone as string,
    p_custom: custom,
    p_stage_id: (input.stageId ?? null) as string,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'A customer with that email already exists here.',
        'customers.email_taken',
      );
    }
    if (error.code === '23514') {
      throw new DomainError(error.message, 'customers.custom_invalid');
    }
    // 42501 is the function refusing a row this caller may not change, and it is deliberately
    // indistinguishable from the row not existing.
    if (error.code === '42501') {
      throw new DomainError(
        'That customer is not yours to change.',
        'customers.update_refused',
      );
    }
    throw new DomainError(error.message, 'customers.update_failed');
  }
}
