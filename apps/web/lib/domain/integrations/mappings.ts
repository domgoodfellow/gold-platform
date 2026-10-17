import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import {
  parseCustom,
  createFieldDefinition,
  listFieldDefinitions,
  type CustomInput,
  type CustomValues,
  type FieldDefinition,
} from '@/lib/domain/fields/field-definitions';

/** Optional company facts use the existing tenant field registry, not new Customer columns. */
export async function prepareImportFields(db: Db, organizationId: string, headers: string[]): Promise<void> {
  const definitions = await listFieldDefinitions(db, { organizationId, entityType: 'customer' });
  const fields = [
    ['owner_name', 'Contact name', 'text'], ['website', 'Website', 'text'],
    ['industry', 'Industry', 'text'], ['sic_code', 'SIC code', 'text'],
    ['estimated_revenue_band', 'Estimated revenue band', 'text'],
    ['team_size_band', 'Team size band', 'text'], ['do_not_call', 'Do not call', 'boolean'],
    ['lead_status', 'Source lead status', 'text'],
  ] as const;
  for (const [key, label, kind] of fields) {
    if (!headers.includes(key) || definitions.some((definition) => definition.key === key)) continue;
    await createFieldDefinition(db, { organizationId, entityType: 'customer', key, label, kind, required: false });
  }
}

/**
 * What a source column becomes. `ignore` and `custom` cover an open-ended source; `core` is the
 * closed set of columns `customers` itself has (the custom-field registry rule — nothing else is a real column to target).
 */
export type MappingTarget =
  | { kind: 'ignore' }
  | { kind: 'core'; field: 'name' | 'email' | 'phone' }
  | { kind: 'location'; field: 'address' | 'city' | 'province' }
  | { kind: 'custom'; key: string };

/**
 * A normalization step applied before validation, not a field kind of its own (the custom-field registry rule names the six
 * kinds and this isn't a seventh) — `url` and `e164` clean up a value the way a person retyping
 * it by hand would, and still land in a `text` custom field afterward.
 */
export type MappingFieldTransform = 'none' | 'trim_lowercase' | 'e164' | 'url' | 'integer';

export type MappingField = {
  sourceColumn: string;
  target: MappingTarget;
  transform: MappingFieldTransform;
};

export type IntegrationMapping = {
  id: string;
  resourceId: string;
  targetEntity: 'customer';
  fields: MappingField[];
  dedupeKey: string | null;
  createdAt: string;
};

export async function listMappings(
  db: Db,
  input: { organizationId: string; resourceId: string },
): Promise<IntegrationMapping[]> {
  const { data, error } = await db
    .from('integration_mappings')
    .select('id, resource_id, target_entity, mapping, dedupe_key, created_at')
    .eq('organization_id', input.organizationId)
    .eq('resource_id', input.resourceId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'integrations.mappings_list_failed');
  }

  return (data ?? []).map(toMapping);
}

export async function getMapping(
  db: Db,
  input: { organizationId: string; mappingId: string },
): Promise<IntegrationMapping | null> {
  const { data, error } = await db
    .from('integration_mappings')
    .select('id, resource_id, target_entity, mapping, dedupe_key, created_at')
    .eq('organization_id', input.organizationId)
    .eq('id', input.mappingId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'integrations.mapping_get_failed');
  }
  return data ? toMapping(data) : null;
}

function toMapping(row: {
  id: string;
  resource_id: string;
  target_entity: string;
  mapping: unknown;
  dedupe_key: string | null;
  created_at: string;
}): IntegrationMapping {
  return {
    id: row.id,
    resourceId: row.resource_id,
    targetEntity: 'customer',
    fields: Array.isArray(row.mapping) ? (row.mapping as MappingField[]) : [],
    dedupeKey: row.dedupe_key,
    createdAt: row.created_at,
  };
}

export async function createMapping(
  db: Db,
  input: {
    organizationId: string;
    resourceId: string;
    fields: MappingField[];
    dedupeKey?: string | null;
  },
): Promise<string> {
  await requireActor(db);

  if (input.fields.length === 0) {
    throw new DomainError('Map at least one column before continuing.', 'integrations.mapping_empty');
  }
  if (!input.fields.some((field) => field.target.kind === 'core' && field.target.field === 'name')) {
    throw new DomainError('Something has to map to Name.', 'integrations.mapping_needs_name');
  }

  const { data, error } = await db.rpc('record_integration_mapping', {
    p_organization_id: input.organizationId,
    p_resource_id: input.resourceId,
    p_target_entity: 'customer',
    p_mapping: input.fields,
    p_dedupe_key: (input.dedupeKey ?? null) as string,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot create mappings here.', 'integrations.forbidden');
    }
    throw new DomainError(error.message, 'integrations.mapping_create_failed');
  }

  return data;
}

// ---------------------------------------------------------------------------
// Suggesting a mapping — deterministic, not a model. See CLAUDE.md: honest and testable first;
// an AI-assisted upgrade is a separable later change, the same propose/apply shape the draft-then-apply rule already
// uses elsewhere.
// ---------------------------------------------------------------------------

const CORE_SYNONYMS: Record<'name' | 'email' | 'phone', string[]> = {
  name: ['name', 'businessname', 'companyname', 'company', 'fullname', 'customername', 'contactname'],
  email: ['email', 'emailaddress', 'contactemail', 'e_mail'.replace(/_/g, '')],
  phone: ['phone', 'phonenumber', 'telephone', 'contactphone', 'phonee164', 'mobile', 'cell'],
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function defaultTransform(field: 'name' | 'email' | 'phone'): MappingFieldTransform {
  if (field === 'email') return 'trim_lowercase';
  if (field === 'phone') return 'e164';
  return 'none';
}

/** One column, one guess — never applied silently; the mapping table shows every guess for review before anything is staged. */
export function suggestMapping(headers: string[], definitions: FieldDefinition[]): MappingField[] {
  const usedCore = new Set<string>();

  return headers.map((header) => {
    const normalized = normalizeHeader(header);
    const locationField = normalized === 'address' || normalized === 'streetaddress' ? 'address'
      : normalized === 'city' ? 'city' : normalized === 'province' || normalized === 'region' ? 'province' : null;
    if (locationField) {
      return { sourceColumn: header, target: { kind: 'location', field: locationField }, transform: 'none' } satisfies MappingField;
    }

    for (const [coreField, synonyms] of Object.entries(CORE_SYNONYMS) as [
      'name' | 'email' | 'phone',
      string[],
    ][]) {
      if (!usedCore.has(coreField) && synonyms.includes(normalized)) {
        usedCore.add(coreField);
        return {
          sourceColumn: header,
          target: { kind: 'core', field: coreField },
          transform: defaultTransform(coreField),
        } satisfies MappingField;
      }
    }

    const definition = definitions.find(
      (candidate) => normalizeHeader(candidate.key) === normalized || normalizeHeader(candidate.label) === normalized,
    );
    if (definition) {
      return {
        sourceColumn: header,
        target: { kind: 'custom', key: definition.key },
        transform: definition.kind === 'number' ? 'integer' : 'none',
      } satisfies MappingField;
    }

    return { sourceColumn: header, target: { kind: 'ignore' }, transform: 'none' } satisfies MappingField;
  });
}

// ---------------------------------------------------------------------------
// Applying a mapping to one source row — the same validation every other write into `custom`
// already runs (`parseCustom`), reused rather than reimplemented (a rule needed
// by a second caller is extracted first, then called twice; never copied).
// ---------------------------------------------------------------------------

export type NormalizedCustomerRow = {
  name: string;
  email: string | null;
  phone: string | null;
  custom: CustomValues;
  location: { address: string | null; city: string | null; province: string | null };
};

export function importValue(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  return /^(null|none|nan)$/i.test(value) ? '' : value;
}

function applyTransform(
  transform: MappingFieldTransform,
  raw: string,
  sourceColumn: string,
): { value: string; warning: string | null } {
  const trimmed = importValue(raw);
  if (trimmed.length === 0) return { value: '', warning: null };

  switch (transform) {
    case 'trim_lowercase':
      return { value: trimmed.toLowerCase(), warning: null };
    case 'e164': {
      const cleaned = trimmed.replace(/(?!^\+)[^\d]/g, '');
      return { value: /^1\d{10}$/.test(cleaned) ? `+${cleaned}` : cleaned, warning: null };
    }
    case 'url': {
      const looksLikeUrl = /^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed);
      return {
        value: trimmed,
        warning: looksLikeUrl ? null : `“${sourceColumn}”: “${trimmed}” doesn’t look like a website address.`,
      };
    }
    case 'integer': {
      const digits = trimmed.replace(/[^\d-]/g, '');
      const parsed = Number.parseInt(digits, 10);
      return {
        value: Number.isFinite(parsed) ? String(parsed) : '',
        warning: Number.isFinite(parsed) ? null : `“${sourceColumn}”: “${trimmed}” isn’t a whole number.`,
      };
    }
    case 'none':
    default:
      return { value: trimmed, warning: null };
  }
}

/**
 * One source row → one candidate customer, plus every problem found along the way. Never
 * throws — a row with problems is still returned, marked, so the caller can stage it as
 * `invalid` rather than losing it silently.
 */
export function normalizeImportRow(
  fields: MappingField[],
  definitions: FieldDefinition[],
  raw: Record<string, string>,
): { normalized: NormalizedCustomerRow; validationErrors: string[] } {
  const errors: string[] = [];
  let name = '';
  let email: string | null = null;
  let phone: string | null = null;
  const customInput: CustomInput = {};
  const location: NormalizedCustomerRow['location'] = { address: null, city: null, province: null };

  for (const field of fields) {
    if (field.target.kind === 'ignore') continue;

    const { value, warning } = applyTransform(field.transform, raw[field.sourceColumn] ?? '', field.sourceColumn);
    if (warning) errors.push(warning);

    if (field.target.kind === 'core') {
      if (field.target.field === 'name') name = value;
      else if (field.target.field === 'email') email = value || null;
      else if (field.target.field === 'phone') phone = value || null;
    } else if (field.target.kind === 'location') {
      location[field.target.field] = value || null;
    } else if (value.length > 0) {
      customInput[field.target.key] = value;
    }
  }

  if (name.trim().length === 0) {
    errors.push('Nothing mapped to Name, or the mapped column was blank on this row.');
  }
  if (email !== null && !email.includes('@')) {
    errors.push(`“${email}” is not a valid email address.`);
  }

  let custom: CustomValues = {};
  try {
    custom = parseCustom(definitions, customInput);
  } catch (error) {
    if (error instanceof DomainError) {
      errors.push(error.message);
    } else {
      throw error;
    }
  }

  return {
    normalized: { name, email, phone, custom, location },
    validationErrors: errors,
  };
}
