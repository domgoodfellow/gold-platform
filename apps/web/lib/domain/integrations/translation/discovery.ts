import { keyNorm, looksLikeLocation, plain } from './normalize';

/**
 * Source discovery: what an unfamiliar export contains, read from the rows themselves. Nested
 * JSON inside a text column becomes its own columns (`meta.streetAddress`), each column is
 * profiled, and every column that matches a known concept is suggested as its source. Nothing is
 * applied here; a person reviews the suggestion on the import's interpretation page.
 */

export const CONCEPTS = [
  'business_name', 'person_name', 'phone', 'email', 'website',
  'street_address', 'address_location', 'city', 'province', 'postal_code',
  'industry', 'sic_code', 'contact_title', 'employee_count', 'estimated_revenue',
  'legacy_status', 'do_not_call', 'source_id',
] as const;
export type Concept = (typeof CONCEPTS)[number];

export const CONCEPT_LABELS: Record<Concept, string> = {
  business_name: 'Business name', person_name: 'Person name', phone: 'Telephone', email: 'Email',
  website: 'Website', street_address: 'Street address', address_location: 'City, province and postal code together',
  city: 'City', province: 'Province', postal_code: 'Postal code', industry: 'Industry', sic_code: 'SIC code',
  contact_title: 'Role or title', employee_count: 'Estimated employees', estimated_revenue: 'Estimated revenue',
  legacy_status: 'Source status', do_not_call: 'Do not call', source_id: 'Source record ID',
};

/** Which translated entity a concept describes. The telephone is the business's where a business exists (see `translate.ts`). */
export const CONCEPT_ENTITY: Record<Concept, 'business' | 'person' | 'address' | 'record'> = {
  business_name: 'business', website: 'business', industry: 'business', sic_code: 'business', employee_count: 'business',
  estimated_revenue: 'business', phone: 'business', person_name: 'person', email: 'person', contact_title: 'person',
  street_address: 'address', address_location: 'address', city: 'address', province: 'address', postal_code: 'address',
  legacy_status: 'record', do_not_call: 'record', source_id: 'record',
};

const ALIASES: Record<Concept, string[]> = {
  business_name: ['business_name', 'company', 'company_name', 'business', 'organization', 'organisation', 'organization_name', 'account_name', 'organization.name', 'legal_name', 'trade_name'],
  person_name: ['full_name', 'contact_name', 'person_name', 'owner_name', 'name', 'contact', 'first_and_last_name'],
  phone: ['phone_e164', 'phone', 'phone_number', 'telephone', 'tel', 'mobile', 'work_phone', 'business_phone', 'cell'],
  email: ['contact_email', 'person_email', 'email', 'email_address', 'work_email'],
  website: ['business_website', 'website', 'web_site', 'company_website', 'url', 'domain'],
  street_address: ['meta.streetAddress', 'metadata.streetAddress', 'streetAddress', 'street_address', 'address1', 'address_line1', 'address', 'street'],
  address_location: ['meta.cityOrLocation', 'metadata.cityOrLocation', 'cityOrLocation', 'city_or_location', 'location'],
  city: ['city', 'town', 'municipality'],
  province: ['province', 'state', 'region', 'province_state', 'state_province'],
  postal_code: ['postal_code', 'postcode', 'zip', 'zip_code', 'postal'],
  industry: ['business_industry', 'industry', 'meta.displayIndustrySic', 'metadata.industry', 'industry_name', 'sector', 'category'],
  sic_code: ['business_sic_code', 'sic_code', 'sic', 'industry_sic', 'industry_code'],
  contact_title: ['affiliation_role', 'meta.contactTitle', 'metadata.contactTitle', 'contactTitle', 'contact_title', 'title', 'job_title', 'position', 'role'],
  employee_count: ['business_estimated_employees', 'meta.employees', 'metadata.employees', 'employees', 'employee_count', 'team_size'],
  estimated_revenue: ['business_estimated_revenue', 'meta.salesVolume', 'metadata.salesVolume', 'salesVolume', 'estimated_revenue', 'annual_sales', 'revenue'],
  legacy_status: ['lead_status', 'status', 'lifecycle', 'lead_stage'],
  do_not_call: ['do_not_call', 'dnc', 'opt_out', 'suppressed', 'unsubscribe'],
  source_id: ['source_ref', 'source_record_id', 'id', 'lead_id', 'source_id', 'external_id', 'record_id'],
};

const RESTRICTED = /(?:^|[._-])(?:password|passwd|pwd|secret|token|credential|api[_-]?key|private[_-]?key|cookie|session[_-]?id|authorization|auth[_-]?header|otp|refresh[_-]?token)(?:$|[._-])/i;

/** A column that may hold a credential. Never read into a contact, never shown as an example. */
export function isSensitiveColumn(column: string): boolean {
  return RESTRICTED.test(column);
}

export type ConceptMapping = Partial<Record<Concept, string>>;

export type ColumnProfile = {
  name: string;
  populated: number;
  /** Where the column came from: the file's own header, or a key found inside nested JSON. */
  origin: 'column' | 'nested';
  examples: string[];
  sensitive: boolean;
  /** How many values read as an address or a city-and-postal string. */
  locationLike: number;
};

export type SourceDiscovery = {
  rowCount: number;
  columns: ColumnProfile[];
  mapping: ConceptMapping;
  nestedColumns: string[];
  /** The source is a GuildOps Import Workbench `contacts_flat.csv`: its columns are known and its `source_ref` is the stable ID. */
  workbenchPackage: boolean;
  counts: { businesses: number; people: number; phones: number; emails: number; addresses: number };
};

const TAGGED_JSON = /\[([A-Za-z_]+)\](\s*[{[][\s\S]*?)\[\/\1\]/;
const MAX_COLUMNS = 700;

/**
 * One source row with every nested JSON value lifted into its own `prefix.key` column. Tagged
 * JSON (`[NF_LEAD_META]{…}[/NF_LEAD_META]`) is lifted under `meta`; a column that is itself JSON
 * is lifted under its own name. The original column stays, so the note or container is still
 * evidence; a list stays as one JSON value rather than becoming hundreds of columns.
 */
export function expandRecord(record: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) out[String(key)] = plain(value);
  for (const [column, raw] of Object.entries(out)) {
    if (!raw) continue;
    const tagged = TAGGED_JSON.exec(raw);
    const payload = tagged ? tagged[2] : raw;
    if (!/^\s*[{[]/.test(payload)) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    const prefix = tagged ? 'meta' : column;
    const collect = (node: unknown, path: string, depth: number) => {
      if (depth > 4 || Object.keys(out).length > MAX_COLUMNS) return;
      if (Array.isArray(node)) { out[path] = JSON.stringify(node); return; }
      if (node && typeof node === 'object') {
        for (const [childKey, childValue] of Object.entries(node as Record<string, unknown>)) {
          const name = childKey.trim();
          if (!name || name.length > 100) continue;
          collect(childValue, `${path}.${name}`, depth + 1);
        }
        return;
      }
      out[path] = plain(node);
    };
    collect(parsed, prefix, 0);
  }
  return out;
}

/** One column per concept, by the first alias present. A column can serve one concept only. */
export function suggestConceptMapping(columns: string[]): ConceptMapping {
  const byKey = new Map<string, string>();
  for (const column of columns) if (!byKey.has(keyNorm(column))) byKey.set(keyNorm(column), column);
  const mapping: ConceptMapping = {};
  const taken = new Set<string>();
  for (const concept of CONCEPTS) {
    for (const alias of ALIASES[concept]) {
      const column = byKey.get(keyNorm(alias));
      if (column && !taken.has(column) && !isSensitiveColumn(column)) { mapping[concept] = column; taken.add(column); break; }
    }
  }
  return mapping;
}

const WORKBENCH_FLAT_COLUMNS = ['source_ref', 'record_status', 'quality_issues', 'business_ref', 'business_name', 'person_ref', 'person_name', 'person_email', 'affiliation_role', 'street_address', 'city', 'province', 'postal_code', 'phone_e164'];

/** The exact concept sources of a Workbench `contacts_flat.csv`, which the aliases alone would partly miss. */
const WORKBENCH_FLAT_MAPPING: ConceptMapping = {
  source_id: 'source_ref', business_name: 'business_name', person_name: 'person_name', phone: 'phone_e164', email: 'person_email',
  website: 'business_website', industry: 'business_industry', sic_code: 'business_sic_code', employee_count: 'business_estimated_employees',
  estimated_revenue: 'business_estimated_revenue', contact_title: 'affiliation_role', street_address: 'street_address', city: 'city',
  province: 'province', postal_code: 'postal_code',
};

export function isWorkbenchFlatPackage(headers: string[]): boolean {
  const present = new Set(headers.map((header) => header.trim()));
  return WORKBENCH_FLAT_COLUMNS.every((column) => present.has(column));
}

/** Profiles every column of the expanded rows and suggests which concept each known one supplies. */
export function discoverSource(rows: Record<string, string>[], headers: string[]): SourceDiscovery {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const header of headers) if (!seen.has(header)) { seen.add(header); columns.push(header); }
  for (const row of rows) for (const key of Object.keys(row)) if (!seen.has(key)) { seen.add(key); columns.push(key); }
  const workbenchPackage = isWorkbenchFlatPackage(headers);
  const mapping = workbenchPackage ? { ...WORKBENCH_FLAT_MAPPING } : suggestConceptMapping(columns);
  const personColumn = mapping.person_name;
  const profiles: ColumnProfile[] = columns.map((name) => {
    const sensitive = isSensitiveColumn(name);
    let populated = 0; let locationLike = 0; const examples: string[] = [];
    for (const row of rows) {
      const value = plain(row[name]);
      if (!value) continue;
      populated += 1;
      if (name === personColumn && looksLikeLocation(value)) locationLike += 1;
      if (!sensitive && examples.length < 2 && !examples.includes(value.slice(0, 90))) examples.push(value.slice(0, 90));
    }
    return { name, populated, origin: headers.includes(name) ? 'column' : 'nested', examples, sensitive, locationLike };
  });
  const populatedCount = (concept: Concept) => { const column = mapping[concept]; return column ? rows.filter((row) => plain(row[column])).length : 0; };
  return {
    rowCount: rows.length,
    columns: profiles,
    mapping,
    nestedColumns: profiles.filter((column) => column.origin === 'nested').map((column) => column.name),
    workbenchPackage,
    counts: {
      businesses: populatedCount('business_name'),
      people: populatedCount('person_name'),
      phones: populatedCount('phone'),
      emails: populatedCount('email'),
      addresses: Math.max(populatedCount('street_address'), populatedCount('address_location'), populatedCount('city')),
    },
  };
}
