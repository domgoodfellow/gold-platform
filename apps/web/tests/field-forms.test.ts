import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import {
  createFieldDefinition,
  listFieldDefinitions,
  updateFieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';

/**
 * The registry as a form: ordered, relabellable, and unable to reinterpret what it already
 * governs.
 *
 * `field-definitions.test.ts` proves the registry constrains what may be stored (I17) and
 * that two tenants do not collide (I2). This proves the other half M3 needs — that the shape
 * of a form is configuration a business owns rather than an artefact of the order somebody
 * happened to define things in.
 *
 * The sharpest assertions here are the refusals. `kind` and `key` are not editable by
 * anybody, at any privilege, through any path, and the reason is I8: both would silently
 * reinterpret values already written under that key, and would surface as a constraint
 * violation on some later unrelated write rather than at the moment of the edit.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string };

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

function labels(definitions: { label: string }[]): string[] {
  return definitions.map((definition) => definition.label);
}

describe('a field registry is a form', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('ff-alice');
    bob = await newTenant('ff-bob');
  });

  it('appends each new field to the end rather than the front', async () => {
    for (const [key, label] of [
      ['first', 'First'],
      ['second', 'Second'],
      ['third', 'Third'],
    ]) {
      await createFieldDefinition(alice.db, {
        organizationId: alice.organizationId,
        entityType: 'customer',
        key,
        label,
        kind: 'text',
        required: false,
      });
    }

    const definitions = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    expect(labels(definitions)).toEqual(['First', 'Second', 'Third']);
    expect(definitions.map((d) => d.position)).toEqual([0, 1, 2]);
  });

  it('renders in the order the tenant chose, not the order they were defined', async () => {
    const before = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });
    const third = before.find((d) => d.key === 'third')!;

    // The whole slice in one call: what an operator sees is now a number they set.
    await updateFieldDefinition(alice.db, {
      id: third.id,
      label: third.label,
      required: third.required,
      position: 0,
    });

    const after = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    // Third now shares position 0 with First. It sorts ahead on nothing but the tie-break,
    // which is creation order — so the deterministic answer is First, Third, Second.
    expect(labels(after)).toEqual(['First', 'Third', 'Second']);
  });

  it('scopes the order to one entity, so two forms do not interleave', async () => {
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'resource',
      key: 'plate',
      label: 'Registration',
      kind: 'text',
      required: false,
    });

    const resources = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'resource',
    });

    // Position 0 again, in its own form, alongside a customer field already at 0.
    expect(resources.map((d) => d.position)).toEqual([0]);
  });

  it('will not change a field kind, even as a raw update (I8)', async () => {
    const [field] = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    // Not the domain layer declining to pass an argument — the column grant refusing the
    // write. A customer already holding text under this key would otherwise start failing
    // app.check_custom_fields on its next unrelated edit.
    const { error } = await alice.db
      .from('field_definitions')
      .update({ kind: 'number' })
      .eq('id', field.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('will not rename a key, even as a raw update (I8)', async () => {
    const [field] = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    const { error } = await alice.db
      .from('field_definitions')
      .update({ key: 'renamed' })
      .eq('id', field.id);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('does not touch a value already stored when the form is rearranged (I8)', async () => {
    await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Before The Edit Ltd',
      custom: { first: 'kept', second: 'also kept', third: 'kept too' },
    });

    const [field] = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    await updateFieldDefinition(alice.db, {
      id: field.id,
      label: 'Renamed Entirely',
      required: true,
      position: 9,
    });

    const customers = await listCustomers(alice.db, {
      organizationId: alice.organizationId,
    });
    const customer = customers.find((c) => c.name === 'Before The Edit Ltd');

    // The label moved and the field became required. The row is untouched, and is still
    // keyed by `first` — which is exactly why `key` is the column that may never change.
    expect(customer?.custom.first).toBe('kept');
  });

  it('refuses an edit to a member without the capability, through both paths (I12)', async () => {
    const field = await createFieldDefinition(bob.db, {
      organizationId: bob.organizationId,
      entityType: 'customer',
      key: 'theirs',
      label: 'Theirs',
      kind: 'text',
      required: false,
    });

    // Keeps role.manage so assign_role does not refuse to leave the tenant unmanageable.
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Fields',
      capabilities: ['role.manage', 'customer.create'],
    });
    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();
    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      updateFieldDefinition(bob.db, {
        id: field,
        label: 'Sneaky',
        required: false,
        position: 0,
      }),
    ).rejects.toMatchObject({ code: 'fields.forbidden' });

    // And the path that never touches TypeScript. A refused update matches zero rows and
    // raises nothing, so the assertion is that nothing changed rather than that it errored.
    await bob.db.from('field_definitions').update({ label: 'Sneaky' }).eq('id', field);

    const after = await listFieldDefinitions(bob.db, {
      organizationId: bob.organizationId,
      entityType: 'customer',
    });
    expect(after.find((d) => d.id === field)?.label).toBe('Theirs');
  });

  it('does not let one tenant rearrange another tenant’s form', async () => {
    const [mine] = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    await expect(
      updateFieldDefinition(bob.db, {
        id: mine.id,
        label: 'Hijacked',
        required: false,
        position: 0,
      }),
    ).rejects.toMatchObject({ code: 'fields.forbidden' });

    const after = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });
    expect(after.find((d) => d.id === mine.id)?.label).not.toBe('Hijacked');
  });

  it('refuses a position that is not a whole number', async () => {
    const [field] = await listFieldDefinitions(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
    });

    await expect(
      updateFieldDefinition(alice.db, {
        id: field.id,
        label: field.label,
        required: field.required,
        position: 1.5,
      }),
    ).rejects.toMatchObject({ code: 'fields.position_invalid' });
  });
});
