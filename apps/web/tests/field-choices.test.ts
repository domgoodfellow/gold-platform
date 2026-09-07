import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer, listCustomers } from '@/lib/domain/customers/customers';
import {
  createFieldDefinition,
  listFieldDefinitions,
  updateFieldDefinition,
} from '@/lib/domain/fields/field-definitions';
import { foundBusiness } from './helpers/founding';

/**
 * The three kinds a business can configure that it could not before: a choice, several
 * choices, and a date.
 *
 * **Every claim here is made twice, and the second time is the one that matters.** The domain
 * layer produces a message naming the field; `app.check_custom_fields` produces the guarantee.
 * Every entity table grants INSERT to `authenticated`, so a direct PostgREST call never passes
 * through `parseCustom` at all — which is why the raw path is asserted for each kind rather
 * than assumed to follow from the tidy one. `field-definitions.test.ts` establishes that
 * discipline for text, number and boolean; this extends it rather than restating it.
 *
 * The other half is what a business can *do to its own configuration afterwards*. A choice
 * list is the first piece of configuration that is editable, non-trivial, and load-bearing on
 * rows already written, so the two edits that matter — adding a choice and removing one — are
 * both asserted here, including the asymmetry between them that I8 requires.
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

/** Insert a customer without going through the domain layer, the way a raw RPC call would. */
async function insertCustomerDirectly(tenant: Tenant, custom: unknown) {
  return tenant.db.from('customers').insert({
    organization_id: tenant.organizationId,
    name: `Direct ${randomUUID().slice(0, 6)}`,
    custom: custom as never,
    created_by: tenant.userId,
  });
}

async function definitionFor(tenant: Tenant, key: string) {
  const definitions = await listFieldDefinitions(tenant.db, {
    organizationId: tenant.organizationId,
    entityType: 'customer',
  });
  return definitions.find((definition) => definition.key === key)!;
}

describe('fields that offer a choice, and fields that hold a date', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('fc-alice');
    bob = await newTenant('fc-bob');

    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'service_level',
      label: 'Service level',
      kind: 'select',
      required: false,
      options: ['Standard', 'Priority'],
    });

    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'coverage',
      label: 'Coverage',
      kind: 'multi_select',
      required: false,
      options: ['Weekdays', 'Weekends', 'Nights'],
    });

    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'contract_from',
      label: 'Contract from',
      kind: 'date',
      required: false,
    });
  });

  // -------------------------------------------------------------------------
  // Defining one
  // -------------------------------------------------------------------------

  it('refuses a choice field that offers no choices', async () => {
    // A dropdown with nothing in it is a field nobody can fill in, and `required` on one is a
    // form that can never be submitted. Refused at definition time so it cannot exist.
    await expect(
      createFieldDefinition(alice.db, {
        organizationId: alice.organizationId,
        entityType: 'customer',
        key: 'empty_choice',
        label: 'Empty choice',
        kind: 'select',
        required: false,
        options: [],
      }),
    ).rejects.toMatchObject({ code: 'fields.options_required' });
  });

  it('refuses two identical choices, which nothing could tell apart', async () => {
    await expect(
      createFieldDefinition(alice.db, {
        organizationId: alice.organizationId,
        entityType: 'customer',
        key: 'doubled',
        label: 'Doubled',
        kind: 'select',
        required: false,
        options: ['Same', 'Same'],
      }),
    ).rejects.toMatchObject({ code: 'fields.option_duplicated' });
  });

  it('drops blank lines rather than refusing them', async () => {
    // A textarea ends with a newline when somebody presses return after the last choice, and
    // refusing that would be the platform being pedantic about a keystroke.
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'trailing',
      label: 'Trailing',
      kind: 'select',
      required: false,
      options: ['One', '  ', 'Two', ''],
    });

    expect((await definitionFor(alice, 'trailing')).options).toEqual(['One', 'Two']);
  });

  it('keeps options off a kind that cannot offer them', async () => {
    // Somebody typed choices, then changed the kind. The kind is what they meant.
    await createFieldDefinition(alice.db, {
      organizationId: alice.organizationId,
      entityType: 'customer',
      key: 'plain_note',
      label: 'Plain note',
      kind: 'text',
      required: false,
      options: ['Ignored'],
    });

    expect((await definitionFor(alice, 'plain_note')).options).toEqual([]);
  });

  it('refuses options written straight onto a text field (I17)', async () => {
    // The check constraint rather than the domain layer, because a raw PostgREST update names
    // a column and never passes through `cleanOptions`.
    const plain = await definitionFor(alice, 'plain_note');
    const { error } = await alice.db
      .from('field_definitions')
      .update({ options: ['Sneaky'] })
      .eq('id', plain.id);

    expect(error).not.toBeNull();
  });

  it('lets two tenants offer different choices under one key (I2)', async () => {
    await createFieldDefinition(bob.db, {
      organizationId: bob.organizationId,
      entityType: 'customer',
      key: 'service_level',
      label: 'Serviceniveau',
      kind: 'select',
      required: false,
      options: ['Basis', 'Spoed'],
    });

    expect((await definitionFor(alice, 'service_level')).options).toEqual([
      'Standard',
      'Priority',
    ]);
    expect((await definitionFor(bob, 'service_level')).options).toEqual(['Basis', 'Spoed']);
  });

  // -------------------------------------------------------------------------
  // A single choice
  // -------------------------------------------------------------------------

  it('stores a choice the business offers', async () => {
    const id = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Chose Priority',
      custom: { service_level: 'Priority' },
    });

    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    expect(customers.find((c) => c.id === id)?.custom.service_level).toBe('Priority');
  });

  it('refuses a choice the business does not offer', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Invented',
        custom: { service_level: 'Platinum' },
      }),
    ).rejects.toMatchObject({ code: 'fields.not_an_option' });
  });

  it('refuses that same choice written straight to the table (I17)', async () => {
    // **The assertion the whole kind exists for.** Without it, `select` is a text field with a
    // nicer form and the dropdown is a suggestion.
    const { error } = await insertCustomerDirectly(alice, { service_level: 'Platinum' });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('does not offer');
  });

  it('refuses another tenant’s choice, even though it is somebody’s (I2)', async () => {
    // 'Spoed' is a real option — Bob's. Alice's field does not offer it, and the check reads
    // the definition beside the row rather than any definition anywhere.
    const { error } = await insertCustomerDirectly(alice, { service_level: 'Spoed' });
    expect(error).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Several choices
  // -------------------------------------------------------------------------

  it('stores several choices as a list', async () => {
    const id = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Two of three',
      custom: { coverage: ['Weekdays', 'Nights'] },
    });

    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    expect(customers.find((c) => c.id === id)?.custom.coverage).toEqual([
      'Weekdays',
      'Nights',
    ]);
  });

  it('treats nothing ticked as nothing said', async () => {
    const id = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Nothing ticked',
      custom: { coverage: [] },
    });

    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    expect(customers.find((c) => c.id === id)?.custom.coverage).toBeUndefined();
  });

  it('refuses a list containing a choice the business does not offer', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'One good one bad',
        custom: { coverage: ['Weekdays', 'Bank holidays'] },
      }),
    ).rejects.toMatchObject({ code: 'fields.not_an_option' });
  });

  it('refuses that list written straight to the table (I17)', async () => {
    const { error } = await insertCustomerDirectly(alice, {
      coverage: ['Weekdays', 'Bank holidays'],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('does not offer');
  });

  it('refuses a single string where the registry declares a list (I17)', async () => {
    const { error } = await insertCustomerDirectly(alice, { coverage: 'Weekdays' });
    expect(error).not.toBeNull();
    expect(error!.message).toContain('expects');
  });

  // -------------------------------------------------------------------------
  // A date
  // -------------------------------------------------------------------------

  it('stores a date exactly as written', async () => {
    const id = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Dated',
      custom: { contract_from: '2026-03-04' },
    });

    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    // The string, not a reformatting of it. A value that changes shape between being written
    // and read back is a value two screens can disagree about.
    expect(customers.find((c) => c.id === id)?.custom.contract_from).toBe('2026-03-04');
  });

  it('refuses a day that does not exist', async () => {
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Impossible',
        custom: { contract_from: '2026-02-31' },
      }),
    ).rejects.toMatchObject({ code: 'fields.not_a_date' });
  });

  it('refuses a date spelled any other way', async () => {
    // A real date and a real ambiguity: 03/04 is March to one reader and April to another.
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Ambiguous',
        custom: { contract_from: '03/04/2026' },
      }),
    ).rejects.toMatchObject({ code: 'fields.not_a_date' });
  });

  it('refuses both of those written straight to the table (I17)', async () => {
    const impossible = await insertCustomerDirectly(alice, { contract_from: '2026-02-31' });
    expect(impossible.error).not.toBeNull();

    const ambiguous = await insertCustomerDirectly(alice, { contract_from: '03/04/2026' });
    expect(ambiguous.error).not.toBeNull();
    expect(ambiguous.error!.message).toContain('YYYY-MM-DD');
  });

  // -------------------------------------------------------------------------
  // Changing the choices afterwards
  // -------------------------------------------------------------------------

  it('lets a business add a choice, and accepts it immediately', async () => {
    const field = await definitionFor(alice, 'service_level');

    await updateFieldDefinition(alice.db, {
      id: field.id,
      label: field.label,
      required: field.required,
      position: field.position,
      kind: field.kind,
      options: [...field.options, 'Emergency'],
    });

    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Emergency customer',
        custom: { service_level: 'Emergency' },
      }),
    ).resolves.toBeTypeOf('string');
  });

  it('leaves rows alone when a business stops offering a choice (I8)', async () => {
    // **The asymmetry this kind is built around.** Removing an option changes what happens
    // next and never what already happened: the customer who chose Priority still reads
    // Priority, because the trigger fires on write and nothing rewrote that row.
    const field = await definitionFor(alice, 'service_level');

    await updateFieldDefinition(alice.db, {
      id: field.id,
      label: field.label,
      required: field.required,
      position: field.position,
      kind: field.kind,
      options: field.options.filter((option) => option !== 'Priority'),
    });

    const customers = await listCustomers(alice.db, { organizationId: alice.organizationId });
    expect(
      customers.find((c) => c.name === 'Chose Priority')?.custom.service_level,
    ).toBe('Priority');

    // And the other half: what it does change is the next write.
    await expect(
      createCustomer(alice.db, {
        organizationId: alice.organizationId,
        name: 'Too late',
        custom: { service_level: 'Priority' },
      }),
    ).rejects.toMatchObject({ code: 'fields.not_an_option' });
  });

  it('still refuses a kind change, now that options are editable', async () => {
    // The line the column grant draws: adding a choice does not reinterpret what is stored,
    // and turning a choice into a number does. Both arrive as an update to one row.
    const field = await definitionFor(alice, 'service_level');
    const { error } = await alice.db
      .from('field_definitions')
      .update({ kind: 'number' })
      .eq('id', field.id);

    expect(error).not.toBeNull();
    expect((await definitionFor(alice, 'service_level')).kind).toBe('select');
  });

  it('does not let one tenant rewrite another tenant’s choices', async () => {
    const mine = await definitionFor(alice, 'service_level');

    await expect(
      updateFieldDefinition(bob.db, {
        id: mine.id,
        label: mine.label,
        required: mine.required,
        position: mine.position,
        kind: mine.kind,
        options: ['Hijacked'],
      }),
    ).rejects.toMatchObject({ code: 'fields.forbidden' });

    expect((await definitionFor(alice, 'service_level')).options).not.toContain('Hijacked');
  });
});
