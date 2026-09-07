import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/** Platform vocabulary, not tenant configuration — a tenant defines *fields*, not core entities. Mirrors the check constraint on `field_definitions.entity_type`. */
export const CUSTOM_FIELD_ENTITIES = [
  'customer',
  'location',
  'resource',
  'work_item',
  'asset',
] as const;

export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** Wording for the selector that exists now that more than one entity carries fields. */
export const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  customer: 'Customers',
  location: 'Locations',
  resource: 'Resources',
  work_item: 'Work items',
  asset: 'Assets',
};

export function isCustomFieldEntity(value: string): value is CustomFieldEntity {
  return (CUSTOM_FIELD_ENTITIES as readonly string[]).includes(value);
}

/** Also platform vocabulary — each kind has a coercion branch here and a validation branch in `app.check_custom_fields`, so adding one is code plus a migration. */
export const FIELD_KINDS = [
  'text',
  'number',
  'boolean',
  'select',
  'multi_select',
  'date',
] as const;

export type FieldKind = (typeof FIELD_KINDS)[number];

/** Wording for the one screen that renders the choice. Describes the platform, so not per-tenant. */
export const FIELD_KIND_LABELS: Record<FieldKind, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes / no',
  select: 'Choice',
  multi_select: 'Choices',
  date: 'Date',
};

/** The one place this question is answered — three other files would otherwise each spell out the same check. */
export function offersOptions(kind: FieldKind): boolean {
  return kind === 'select' || kind === 'multi_select';
}

/** How many choices one field may offer, and how long each may be. Mirrors the check constraint. */
const OPTIONS_MAX = 50;
const OPTION_LENGTH_MAX = 64;

/** Shared by the form that renders the inputs and the action that reads them back, so the convention lives in one place. */
export const CUSTOM_FIELD_PREFIX = 'custom_';

export type FieldDefinition = {
  id: string;
  entityType: CustomFieldEntity;
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  /** Where this field sits on the entity's form. The tenant's order, not creation order. */
  position: number;
  /** The stored value on an entity is the option's own text, not an index or id — so a business that stops offering an option doesn't erase it from rows that already carry it. Empty for every other kind. */
  options: string[];
  createdAt: string;
};

/** A validated custom payload, ready to be written to a `custom` column. */
export type CustomValues = Record<string, string | number | boolean | string[]>;

/** `string[]` arrived with `multi_select` — one checkbox group sends its name once per ticked box, so the transport genuinely carries a list. */
export type CustomInput = Record<string, string | string[]>;

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,62}$/;
const LABEL_MAX = 100;

/** Whether a string names a kind this build knows how to render and validate. */
export function isKind(value: string): value is FieldKind {
  return (FIELD_KINDS as readonly string[]).includes(value);
}

/** Every form in the platform renders this sequence, so changing it here changes the form everywhere. */
export async function listFieldDefinitions(
  db: Db,
  input: { organizationId: string; entityType: CustomFieldEntity },
): Promise<FieldDefinition[]> {
  const { data, error } = await db
    .from('field_definitions')
    .select('id, entity_type, key, label, kind, required, position, options, created_at')
    .eq('organization_id', input.organizationId)
    .eq('entity_type', input.entityType)
    // `position` is not unique, so creation order is the tiebreak that makes the form deterministic rather than merely sorted.
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'fields.list_failed');
  }

  // Discards anything a future migration adds that this build doesn't know how to render, rather than rendering it wrongly.
  return (data ?? [])
    .filter((row) => isCustomFieldEntity(row.entity_type) && isKind(row.kind))
    .map((row) => ({
      id: row.id,
      entityType: row.entity_type as CustomFieldEntity,
      key: row.key,
      label: row.label,
      kind: row.kind as FieldKind,
      required: row.required,
      position: row.position,
      options: row.options ?? [],
      createdAt: row.created_at,
    }));
}

/** Mirrors `app.field_options_well_formed`. Blanks are dropped rather than refused — a trailing newline from a textarea isn't an error. */
function cleanOptions(kind: FieldKind, supplied: string[]): string[] {
  if (!offersOptions(kind)) {
    // Not an error — typing choices then switching the kind to Text meant the kind, not a mistake worth blocking.
    return [];
  }

  const options = supplied.map((option) => option.trim()).filter((option) => option.length > 0);

  if (options.length === 0) {
    throw new DomainError(
      'A field that offers a choice needs at least one choice.',
      'fields.options_required',
    );
  }
  if (options.length > OPTIONS_MAX) {
    throw new DomainError(
      `A field can offer at most ${OPTIONS_MAX} choices.`,
      'fields.options_too_many',
    );
  }
  const tooLong = options.find((option) => option.length > OPTION_LENGTH_MAX);
  if (tooLong !== undefined) {
    throw new DomainError(
      `A choice is at most ${OPTION_LENGTH_MAX} characters, and “${tooLong}” is longer.`,
      'fields.option_too_long',
    );
  }
  const duplicate = options.find((option, index) => options.indexOf(option) !== index);
  if (duplicate !== undefined) {
    throw new DomainError(
      `“${duplicate}” is offered twice, and two identical choices cannot be told apart.`,
      'fields.option_duplicated',
    );
  }

  return options;
}

/** Whether the caller may is decided by `field_definitions_insert` (`field.manage`) — this owns only what a well-formed definition looks like. */
export async function createFieldDefinition(
  db: Db,
  input: {
    organizationId: string;
    entityType: string;
    key: string;
    label: string;
    kind: string;
    required: boolean;
    /** The choices, for a kind that offers them. Ignored by every other kind. */
    options?: string[];
  },
): Promise<string> {
  await requireActor(db);

  // Lowercased rather than rejected on case — a mis-cased key is an operator mistake, not an attack, and the stored key is what every row will carry forever.
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

  // Named here rather than left to the check constraint, so the message says what was wrong.
  if (!isCustomFieldEntity(input.entityType)) {
    throw new DomainError(`Not an entity: ${input.entityType}.`, 'fields.entity_unknown');
  }
  if (!isKind(input.kind)) {
    throw new DomainError(`Not a field type: ${input.kind}.`, 'fields.kind_unknown');
  }

  const options = cleanOptions(input.kind, input.options ?? []);

  const { data, error } = await db.rpc('create_field_definition', {
    p_organization_id: input.organizationId,
    p_entity_type: input.entityType,
    p_key: key,
    p_label: label,
    p_kind: input.kind,
    p_required: input.required,
    p_options: options,
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
 * Change how a field appears on the form: its label, whether it's required, where it sits.
 * Never `kind` or `key` — both are refused by the column grant, since each would be a
 * retroactive rewrite of stored values wearing a rename's clothing (I8). Options are editable
 * and `kind` is not: adding a fourth choice doesn't reinterpret the three already stored, but
 * turning a choice into a number would. Removing an option doesn't reach back — rows already
 * carrying it keep it, and only the next write to one of those rows is refused. `kind` is taken
 * here only to decide whether options mean anything; the check constraint reads the *stored*
 * kind, so a caller that lies about it is refused by the database rather than trusted here.
 */
export async function updateFieldDefinition(
  db: Db,
  input: {
    id: string;
    label: string;
    required: boolean;
    position: number;
    kind: FieldKind;
    options?: string[];
  },
): Promise<void> {
  await requireActor(db);

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

  // A sort key, not an index — gaps and duplicates are both fine and both survive.
  if (!Number.isInteger(input.position) || input.position < 0) {
    throw new DomainError(
      'A position is a whole number, counting from zero.',
      'fields.position_invalid',
    );
  }

  const { error } = await db.rpc('update_field_definition', {
    p_id: input.id,
    p_label: label,
    p_required: input.required,
    p_position: input.position,
    p_options: cleanOptions(input.kind, input.options ?? []),
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot manage fields here.', 'fields.forbidden');
    }
    throw new DomainError(error.message, 'fields.update_failed');
  }
}

/**
 * Turn the raw strings a form submits into a validated custom payload — what makes `custom` a
 * registry rather than a junk drawer. Runs in two places on purpose: here it produces a message
 * naming the offending field, while `app.check_custom_fields` produces the guarantee for direct
 * PostgREST calls that never pass through this function (same split as `requireActor` and RLS).
 * Absent and blank are the same thing — HTML sends an empty string for an untouched input, and
 * treating that as a value would store `""` for every field nobody filled in.
 */
export function parseCustom(definitions: FieldDefinition[], raw: CustomInput): CustomValues {
  const declared = new Map(definitions.map((definition) => [definition.key, definition]));

  for (const key of Object.keys(raw)) {
    if (!declared.has(key)) {
      throw new DomainError(`No field named ${key} is defined here.`, 'fields.unknown');
    }
  }

  const values: CustomValues = {};

  for (const definition of definitions) {
    const sent = raw[definition.key];

    // Handled before the blank check — "nothing ticked" is a list, not a blank. A checkbox
    // group sends its name once per ticked box and not at all when none are, so an empty list
    // is written as one, letting untick-everything actually save.
    if (definition.kind === 'multi_select') {
      const chosen = (Array.isArray(sent) ? sent : sent === undefined ? [] : [sent])
        .map((option) => option.trim())
        .filter((option) => option.length > 0);

      const offered = new Set(definition.options);
      const stranger = chosen.find((option) => !offered.has(option));
      if (stranger !== undefined) {
        throw new DomainError(
          `${definition.label} does not offer “${stranger}”.`,
          'fields.not_an_option',
        );
      }
      if (chosen.length === 0) {
        if (definition.required) {
          throw new DomainError(`${definition.label} is required.`, 'fields.required');
        }
        continue;
      }

      // Deduplicated rather than refused — a repeated value is a browser or script repeating itself, and the business meant the choice once.
      values[definition.key] = [...new Set(chosen)];
      continue;
    }

    // Every remaining kind is a single value — a list here means the form sent the same name twice, and the last one wins.
    const supplied = (Array.isArray(sent) ? (sent[sent.length - 1] ?? '') : (sent ?? '')).trim();

    if (definition.kind === 'boolean') {
      // A checkbox sends its value when ticked and nothing when cleared, so absence is a real `false`. `required` on a boolean is therefore always satisfied.
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
      // The blank case is already handled above, so this rejects only genuine non-numbers and infinities.
      if (!Number.isFinite(parsed)) {
        throw new DomainError(`${definition.label} must be a number.`, 'fields.not_a_number');
      }
      values[definition.key] = parsed;
      continue;
    }

    if (definition.kind === 'select') {
      if (!definition.options.includes(supplied)) {
        throw new DomainError(
          `${definition.label} does not offer “${supplied}”.`,
          'fields.not_an_option',
        );
      }
      values[definition.key] = supplied;
      continue;
    }

    if (definition.kind === 'date') {
      // `Date.parse` on an ISO date is UTC-anchored, so this never disagrees with itself by timezone — the value stored is the string, never what a Date would print.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(supplied)) {
        throw new DomainError(
          `${definition.label} is a date, written as YYYY-MM-DD.`,
          'fields.not_a_date',
        );
      }
      const parsed = new Date(`${supplied}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== supplied) {
        throw new DomainError(`${definition.label} is not a real date.`, 'fields.not_a_date');
      }
      values[definition.key] = supplied;
      continue;
    }

    values[definition.key] = supplied;
  }

  return values;
}

/** Extracted at its third caller (`createCustomer`, `createLocation`, `createResource` all needed the identical pair) — reads the registry here rather than accepting one, so a route, an action, and an AI tool all get the same answer without knowing there is a registry at all. */
export async function resolveCustom(
  db: Db,
  input: {
    organizationId: string;
    entityType: CustomFieldEntity;
    custom?: CustomInput;
  },
): Promise<CustomValues> {
  const definitions = await listFieldDefinitions(db, {
    organizationId: input.organizationId,
    entityType: input.entityType,
  });

  return parseCustom(definitions, input.custom ?? {});
}
