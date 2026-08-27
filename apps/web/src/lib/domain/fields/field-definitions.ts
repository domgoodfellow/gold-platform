import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * The entities that can carry tenant-defined fields.
 *
 * Platform vocabulary, not tenant configuration — the same split roles draws between which
 * capabilities exist and which role holds them. A tenant defines *fields*; it cannot invent
 * a core entity. This list mirrors the check constraint on `field_definitions.entity_type`
 * and grows with the migration that adds each entity.
 */
export const CUSTOM_FIELD_ENTITIES = ['customer', 'location', 'resource'] as const;

export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** Wording for the selector that exists now that more than one entity carries fields. */
export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  customer: 'Customers',
  location: 'Locations',
  resource: 'Resources',
};

export function isCustomFieldEntity(value: string): value is CustomFieldEntity {
  return (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

/**
 * What a field can hold.
 *
 * Also platform vocabulary: each kind has a coercion branch here and a validation branch in
 * `app.check_custom_fields`, so adding one is code plus a migration. A kind with neither is
 * a promise the field editor makes and nothing keeps.
 */
export const FIELD_KINDS = ['text', 'number', 'boolean'] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** Wording for the one screen that renders the choice. Describes the platform, so not per-tenant. */
export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes / no',
};

/**
 * The prefix that carries a custom value through a form.
 *
 * Shared by the form that renders the inputs and the action that reads them back, so the
 * convention lives in one place rather than as a string literal in two.
 */
export const CUSTOM_FIELD_PREFIX = 'custom_';

export type FieldDefinition = {
  id: string;
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  createdAt: string;
};

/** A validated custom payload, ready to be written to a `custom` column. */
export type CustomValues = Record<string, string | number | boolean>;

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const LABEL_MAX = 100;

function isKind(value: string): value is FieldKind {
  return (FIELD_KINDS as readonly string[]).includes(value);
}

/**
 * The fields one tenant has defined for one entity type.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS has already
 * restricted the rows to organizations the caller belongs to.
 */
export async function listFieldDefinitions(
  db: Db,
  input: { organizationId: string; entityType: CustomFieldEntity },
): Promise<FieldDefinition[]> {
  const { data, error } = await db
    .from('field_definitions')
    .select('id, entity_type, key, label, kind, required, created_at')
    .eq('organization_id', input.organizationId)
    .eq('entity_type', input.entityType)
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'fields.list_failed');
  }

  // entity_type and kind are `text` in the database, constrained by CHECK. The filters below
  // discard anything a future migration adds that this build does not know how to render,
  // rather than rendering it wrongly.
  return (data ?? [])
    .filter((row) => isCustomFieldEntity(row.entity_type) && isKind(row.kind))
    .map((row) => ({
      id: row.id,
      entityType: row.entity_type as CustomFieldEntity,
      key: row.key,
      label: row.label,
      kind: row.kind as FieldKind,
      required: row.required,
      createdAt: row.created_at,
    }));
}

/**
 * Define a field.
 *
 * Whether the caller *may* is not decided here — `field_definitions_insert` requires
 * `field.manage`, so a caller without it is refused by the database whether it arrives
 * through this function, a raw insert, or an AI tool. What this owns is what a well-formed
 * definition looks like.
 */
export async function createFieldDefinition(
  db: Db,
  input: {
    organizationId: string;
    entityType: string;
    key: string;
    label: string;
    kind: string;
    required: boolean;
  },
): Promise<string> {
  await requireActor(db);

  // Lowercased rather than rejected on case: `VAT_Number` is an operator typing a label into
  // the wrong box, not an attack, and the stored key is what every row will carry forever.
  const key = input.key.trim().toLowerCase();
  if (key.length === 0) {
    throw new DomainError('A field needs a key.', 'fields.key_required');
  }
  if (!KEY_PATTERN.test(key)) {
    throw new DomainError(
      'A key starts with a letter and uses only lowercase letters, numbers and underscores.',
      'fields.key_invalid',
    );
  }

  const label = input.label.trim();
  if (label.length === 0) {
    throw new DomainError('A field needs a label.', 'fields.label_required');
  }
  if (label.length > LABEL_MAX) {
    throw new DomainError(
      `That label is longer than ${LABEL_MAX} characters.`,
      'fields.label_too_long',
    );
  }

  // Named here rather than left to the check constraint, so the message says what was wrong
  // instead of quoting a constraint name.
  if (!isCustomFieldEntity(input.entityType)) {
    throw new DomainError(`Not an entity: ${input.entityType}.`, 'fields.entity_unknown');
  }
  if (!isKind(input.kind)) {
    throw new DomainError(`Not a field type: ${input.kind}.`, 'fields.kind_unknown');
  }

  const { data, error } = await db.rpc('create_field_definition', {
    p_organization_id: input.organizationId,
    p_entity_type: input.entityType,
    p_key: key,
    p_label: label,
    p_kind: input.kind,
    p_required: input.required,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `A field called ${key} already exists here.`,
        'fields.key_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot manage fields here.', 'fields.forbidden');
    }
    throw new DomainError(error.message, 'fields.create_failed');
  }

  return data;
}

/**
 * Turn the raw strings a form submits into a validated custom payload.
 *
 * This is the rule that makes `custom` a registry rather than a junk drawer, and it runs in
 * two independent places on purpose. Here it produces a message naming the offending field;
 * in `app.check_custom_fields` it produces the guarantee, because every entity table grants
 * INSERT to authenticated and a direct PostgREST call never passes through this function.
 * The same shape as `requireActor` alongside RLS: one for the error, one for the promise.
 *
 * Absent and blank are the same thing. HTML sends an empty string for an untouched text
 * input, and treating that as a value would store `""` for every field nobody filled in.
 */
export function parseCustom(
  definitions: FieldDefinition[],
  raw: Record<string, string>,
): CustomValues {
  const declared = new Map(definitions.map((definition) => [definition.key, definition]));

  for (const key of Object.keys(raw)) {
    if (!declared.has(key)) {
      throw new DomainError(`No field named ${key} is defined here.`, 'fields.unknown');
    }
  }

  const values: CustomValues = {};

  for (const definition of definitions) {
    const supplied = raw[definition.key]?.trim() ?? '';

    if (definition.kind === 'boolean') {
      // A checkbox sends its value when ticked and nothing when cleared, so absence is a
      // real `false` rather than "not answered". A boolean is therefore always written, and
      // `required` on one is always satisfied — it does its work on text and number.
      values[definition.key] = supplied.length > 0;
      continue;
    }

    if (supplied.length === 0) {
      if (definition.required) {
        throw new DomainError(`${definition.label} is required.`, 'fields.required');
      }
      continue;
    }

    if (definition.kind === 'number') {
      const parsed = Number(supplied);
      // Number('') is 0 and Number('12abc') is NaN; the blank case is already handled above,
      // so this rejects only genuine non-numbers and the infinities.
      if (!Number.isFinite(parsed)) {
        throw new DomainError(`${definition.label} must be a number.`, 'fields.not_a_number');
      }
      values[definition.key] = parsed;
      continue;
    }

    values[definition.key] = supplied;
  }

  return values;
}

/**
 * Read a tenant's registry for one entity and validate a raw payload against it.
 *
 * Extracted at its third caller. `createCustomer`, `createLocation` and `createResource` all
 * needed the identical pair — fetch the definitions, then `parseCustom` — and the pair is
 * the rule, not either half: reading the registry from anywhere other than the database, or
 * validating against definitions the caller supplied, would each defeat the point.
 *
 * The registry is read here rather than passed in so that a route, a server action and an AI
 * tool all get the same answer without any of them knowing there is a registry at all.
 */
export async function resolveCustom(
  db: Db,
  input: {
    organizationId: string;
    entityType: CustomFieldEntity;
    custom?: Record<string, string>;
  },
): Promise<CustomValues> {
  const definitions = await listFieldDefinitions(db, {
    organizationId: input.organizationId,
    entityType: input.entityType,
  });

  return parseCustom(definitions, input.custom ?? {});
}
