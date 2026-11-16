import { createHash } from 'node:crypto';
import { DomainError } from '@/lib/domain/errors';
import { parseCustom, type CustomInput, type CustomValues, type FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { NormalizedCustomerRow } from '@/lib/domain/integrations/mappings';
import type { TranslationPlan } from './plan';
import { translateSource, type BusinessGroup, type Evidence, type Issue, type TranslatedRecord, type TranslationResult } from './translate';

/**
 * The adapter between translated entities and the existing staging pipeline. Each business group
 * and each person becomes one staging row with a stable source key, so `stage_import_rows` matches
 * and holds them exactly as it does any other row, and a repeat of the same source finds its own
 * rows again. A person's row names its business's row (`company_source_key`); applying resolves
 * that to the business's contact once the business row has been applied in the same run.
 */

/** Custom fields a translated business can carry, created on the tenant's registry before staging when permitted. */
export const BUSINESS_FIELDS = [
  ['industry', 'Industry', 'text'], ['sic_code', 'SIC code', 'text'], ['website', 'Website', 'text'],
  ['estimated_revenue', 'Estimated revenue', 'number'], ['estimated_employees', 'Estimated employees', 'number'],
  ['postal_code', 'Postal code', 'text'], ['do_not_call', 'Do not call', 'boolean'], ['lead_status', 'Source lead status', 'text'],
] as const;

/** What a staging row remembers of its translation: enough for review to explain it and for evidence to stay with the row. */
export type RowTranslation = {
  entity: 'business' | 'person' | 'row';
  /** The source IDs (or 1-based row numbers) this row came from. */
  sourceRefs: string[];
  issues: Issue[];
  evidence: Evidence[];
  /** For a person: the business they are proposed to belong to, and the role. */
  business?: { name: string; sourceKey: string };
  affiliation?: { role: string; state: 'proposed' };
  address?: { street: string; city: string; province: string; postalCode: string; kind: string };
  phone?: { e164: string; display: string; owner: 'business' | 'person' };
  restrictions: { doNotCall: boolean; legacyStatus: string };
};

export type TranslatedStagingRow = {
  key: string;
  raw: Record<string, string>;
  normalized: NormalizedCustomerRow & { translation: RowTranslation; company_source_key?: string };
  validation_errors: string[];
  /** Held for a person's decision before anything is applied. */
  hold: boolean;
};

function fingerprint(raw: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)))).digest('hex');
}

function sourceRef(record: TranslatedRecord): string {
  return record.sourceId ?? `row ${record.index + 1}`;
}

function customFor(definitions: FieldDefinition[], input: Record<string, string>, issues: Issue[]): { custom: CustomValues; errors: string[] } {
  const defined = new Set(definitions.map((definition) => definition.key));
  const kept: CustomInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (!value) continue;
    if (defined.has(key)) kept[key] = value;
    else issues.push({ code: 'field_not_defined', detail: key });
  }
  try {
    const custom = parseCustom(definitions, kept);
    // A yes/no field the row did not supply is not "no": only supplied values reach the contact.
    for (const key of Object.keys(custom)) if (!(key in kept)) delete custom[key];
    return { custom, errors: [] };
  } catch (error) {
    if (error instanceof DomainError) return { custom: {}, errors: [error.message] };
    throw error;
  }
}

/**
 * Turns a translation into staging rows: every business first, then every person. Businesses are
 * staged in their own batches before people so that applying, which runs in staging order, has
 * applied a business before the person who names it.
 */
export function stagingRowsForTranslation(
  result: TranslationResult,
  input: { sourceName: string; plan: TranslationPlan; definitions: FieldDefinition[] },
): { businesses: TranslatedStagingRow[]; people: TranslatedStagingRow[]; rows: TranslatedStagingRow[] } {
  const namespace = createHash('sha256').update(input.sourceName).digest('hex');
  const businessKeys = new Map<BusinessGroup, string>();
  const businesses: TranslatedStagingRow[] = [];
  for (const group of result.businesses) {
    const first = result.records[group.recordIndexes[0]];
    const key = `${namespace}:id:business:${createHash('sha256').update(group.identityKey).digest('hex').slice(0, 32)}`;
    businessKeys.set(group, key);
    const issues = [...group.issues];
    const values: Record<string, string> = {
      industry: group.candidate.industry, sic_code: group.candidate.sicCode, website: group.candidate.website,
      estimated_revenue: group.candidate.estimatedRevenue, estimated_employees: group.candidate.estimatedEmployees,
      postal_code: group.address?.postalCode ?? '', lead_status: group.restrictions.legacyStatus,
      ...(input.plan.suppression === 'reference' && group.restrictions.doNotCall ? { do_not_call: 'true' } : {}),
      ...group.extras,
    };
    const { custom, errors } = customFor(input.definitions, values, issues);
    const translation: RowTranslation = {
      entity: 'business', sourceRefs: group.recordIndexes.map((index) => sourceRef(result.records[index])), issues, evidence: group.evidence,
      ...(group.address ? { address: { street: group.address.street, city: group.address.city, province: group.address.province, postalCode: group.address.postalCode, kind: group.address.kind } } : {}),
      ...(group.phone ? { phone: { e164: group.phone.e164, display: group.phone.display, owner: 'business' } } : {}),
      restrictions: group.restrictions,
    };
    businesses.push({
      key, raw: first.raw, hold: group.candidate.eligibility === 'review',
      validation_errors: errors,
      normalized: {
        name: group.candidate.name, email: null, phone: group.phone?.e164 ?? null, custom,
        location: { address: group.address?.street || null, city: group.address?.city || null, province: group.address?.province || null },
        contact_type: 'company', ...(input.plan.defaultLifecycle ? { default_lifecycle: input.plan.defaultLifecycle } : {}), translation,
      },
    });
  }
  const people: TranslatedStagingRow[] = [];
  for (const record of result.records) {
    if (record.person) {
      const group = result.businessOf.get(record.index);
      const companyKey = record.affiliation && group ? businessKeys.get(group) : undefined;
      const key = record.sourceId ? `${namespace}:id:person:${record.sourceId}` : `${namespace}:row:person:${fingerprint(record.raw)}`;
      const issues = [...record.person.issues, ...(record.affiliation?.issues ?? [])];
      const translation: RowTranslation = {
        entity: 'person', sourceRefs: [sourceRef(record)], issues,
        evidence: record.evidence.filter((item) => !group || ['Person name', 'Email', 'Role or title'].includes(item.concept)),
        ...(group && companyKey ? { business: { name: group.candidate.name, sourceKey: companyKey } } : {}),
        ...(record.affiliation ? { affiliation: { role: record.affiliation.role, state: 'proposed' } } : {}),
        ...(!record.business && record.address ? { address: { street: record.address.street, city: record.address.city, province: record.address.province, postalCode: record.address.postalCode, kind: record.address.kind } } : {}),
        ...(!record.business && record.channels[0] ? { phone: { e164: record.channels[0].e164, display: record.channels[0].display, owner: 'person' } } : {}),
        restrictions: record.restrictions,
      };
      people.push({
        key, raw: record.raw, hold: record.person.eligibility === 'review', validation_errors: [],
        normalized: {
          name: record.person.name, email: record.person.email || null, phone: record.person.phone || null, custom: {},
          location: record.business ? { address: null, city: null, province: null } : { address: record.address?.street || null, city: record.address?.city || null, province: record.address?.province || null },
          contact_type: 'person', ...(input.plan.defaultLifecycle ? { default_lifecycle: input.plan.defaultLifecycle } : {}),
          ...(companyKey ? { company_source_key: companyKey } : {}), ...(record.affiliation?.role ? { affiliation_title: record.affiliation.role } : {}),
          translation,
        },
      });
    } else if (!record.business) {
      // Nothing usable on the row: staged as rejected so the person sees it was read and why.
      const key = record.sourceId ? `${namespace}:id:row:${record.sourceId}` : `${namespace}:row:row:${fingerprint(record.raw)}`;
      people.push({
        key, raw: record.raw, hold: false, validation_errors: ['No business or person name on this row.'],
        normalized: { name: '', email: null, phone: null, custom: {}, location: { address: null, city: null, province: null }, translation: { entity: 'row', sourceRefs: [sourceRef(record)], issues: record.issues, evidence: record.evidence, restrictions: record.restrictions } },
      });
    }
  }
  return { businesses, people, rows: [...businesses, ...people] };
}

/** Translates rows under a plan and prepares them for staging in one call. */
export function prepareTranslatedImport(rows: Record<string, string>[], input: { sourceName: string; plan: TranslationPlan; definitions: FieldDefinition[] }) {
  const result = translateSource(rows, input.plan);
  return { result, staging: stagingRowsForTranslation(result, input) };
}
