import { describe, expect, it } from 'vitest';
import type { Json } from '@/lib/db/database.types';
import { parseCsv } from '@/lib/domain/files/parsers/csv';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createMapping, normalizeImportRow, translationMappingFields, translationPlanOf } from '@/lib/domain/integrations/mappings';
import {
  BUSINESS_FIELDS, defaultPlan, describeQuality, discoverSource, expandRecord, expandRows, inspectRows, interpretationConflicts,
  isWorkbenchFlatPackage, looksLikeLocation, looksLikePersonalName, normalizePhone, normalizeWebsite, phoneDisplay, prepareTranslatedImport,
  proposeInterpretations, splitLocation, stagingRowsForTranslation, translateSource, validatePlan, type TranslationPlan,
} from '@/lib/domain/integrations/translation';

/**
 * The translation engine on synthetic rows: what a row becomes, what is held, what is never
 * invented, and that the same source always stages the same keys. No database; staging itself
 * is proven in `tests/integration/database/translated-import.test.ts`.
 */

const META = (fields: Record<string, Json>) => `[NF_LEAD_META]${JSON.stringify(fields)}[/NF_LEAD_META]`;
const HEADERS = 'id,business_name,full_name,owner_name,phone_e164,contact_email,website,industry,lead_status,do_not_call,notes,colour';
const line = (fields: Record<string, string>) => {
  const values = HEADERS.split(',').map((header) => fields[header] ?? '');
  return values.map((value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)).join(',');
};
const csv = (rows: Record<string, string>[]) => [HEADERS, ...rows.map(line)].join('\n');

const ROWS = {
  ackerman: { id: 'a1', business_name: 'Ackerman Painting', full_name: 'Chris Ackerman', owner_name: 'Chris Ackerman', phone_e164: '+19054664554', contact_email: 'chris@ackerman.example', website: 'ackermanpainting.example', industry: 'Painters', lead_status: 'NEW', notes: META({ streetAddress: '5242 Cherryhill Cres', cityOrLocation: 'Burlington, ON L7L4C4', contactTitle: 'Owner', salesVolume: '$402,000', employees: '4' }) },
  ackermanSecond: { id: 'a2', business_name: 'Ackerman Painting', full_name: 'Pat Ackerman', phone_e164: '+19054664554', website: 'ackermanpainting.example', industry: 'Painters', notes: META({ cityOrLocation: 'Burlington, ON L7L4C4', contactTitle: 'Estimator' }) },
  ackermanThird: { id: 'a3', business_name: 'Ackerman Painting', full_name: '', phone_e164: '+19054664554', website: 'ackermanpainting.example', notes: META({ cityOrLocation: 'Burlington, ON L7L4C4' }) },
  dispatch: { id: 'fr-2', business_name: 'Dispatch Coffee', full_name: '267 Rue Saint-Zotique O', owner_name: '267 Rue Saint-Zotique O', phone_e164: '+15145550123', notes: META({ contactTitle: 'Montreal, QC H2V1A4' }) },
  noPerson: { id: 'b-1', business_name: 'Acme Plumbing', phone_e164: '+14165550120', notes: META({ streetAddress: '123 Main St', cityOrLocation: 'Toronto, ON M5V2H1' }) },
  noBusiness: { id: 'p-1', full_name: 'Morgan Example', phone_e164: '+15145550125', contact_email: 'morgan@example.test', notes: META({ cityOrLocation: 'Québec, QC G1A 0A2', contactTitle: 'Representative' }) },
  personal: { id: 'k-1', business_name: 'Kristy Cameron', full_name: 'Kristy Cameron', phone_e164: '+12509417555', website: 'cameroncontractingltd.example', industry: 'General Contractors', notes: META({ cityOrLocation: 'Courtenay, BC V9N3S1' }) },
  sharedPhoneA: { id: 's-1', business_name: 'North Shore Dental', full_name: 'Dana Lee', phone_e164: '+16045550101', notes: '' },
  sharedPhoneB: { id: 's-2', business_name: 'North Shore Hygiene', full_name: 'Sam Roy', phone_e164: '+16045550101', notes: '' },
  bad: { id: 'bad-1', business_name: 'Willow Services', full_name: 'Taylor Example', phone_e164: '+16135550124', lead_status: 'BAD_DATA', do_not_call: 'true', notes: META({ streetAddress: 'PO Box 10', cityOrLocation: 'Ottawa, ON K1A 0A1' }) },
  custom: { id: 'c-1', business_name: 'Cedar Workshop', full_name: 'Jamie Example', phone_e164: '+15145550123', colour: 'Teal', notes: '' },
  empty: { id: 'e-1', phone_e164: '+15145559999', notes: '' },
};

const definitions: FieldDefinition[] = [
  ...BUSINESS_FIELDS.map(([key, label, kind], index) => ({ id: key, entityType: 'customer' as const, key, label, kind, required: false, position: index, options: [], createdAt: '' })),
  { id: 'colour', entityType: 'customer', key: 'colour', label: 'Colour', kind: 'text', required: false, position: 20, options: [], createdAt: '' },
];

function inspect(rows: Record<string, string>[], patch?: (plan: TranslationPlan) => TranslationPlan) {
  const parsed = parseCsv(csv(rows));
  const base = inspectRows(parsed);
  const plan = patch ? patch(base.plan) : base.plan;
  const expanded = expandRows(parsed.rows);
  return { parsed, plan, inspection: base, ...prepareTranslatedImport(expanded, { sourceName: 'leads.csv', plan, definitions }) };
}
const business = (rows: ReturnType<typeof inspect>, name: string) => rows.staging.businesses.find((row) => row.normalized.name === name)!;
const person = (rows: ReturnType<typeof inspect>, name: string) => rows.staging.people.find((row) => row.normalized.name === name)!;

describe('normalization', () => {
  it('reads telephones, websites, locations and address-like names deterministically', () => {
    expect(normalizePhone('(905) 466-4554')).toBe('+19054664554');
    expect(normalizePhone('+33 1 23 45 67 89')).toBe('+33123456789');
    expect(normalizePhone('12345')).toBe('');
    expect(phoneDisplay('+19054664554')).toBe('(905) 466-4554');
    expect(phoneDisplay('+33123456789')).toBe('+33123456789');
    expect(normalizeWebsite('ackerman.example')).toMatchObject({ value: 'https://ackerman.example', issue: null });
    expect(normalizeWebsite('www.yellowpages.ca/bus/1').issue).toBe('website_is_directory');
    expect(normalizeWebsite('not a site').issue).toBe('website_invalid');
    expect(splitLocation('Burlington, ON L7L4C4')).toEqual({ city: 'Burlington', province: 'ON', postalCode: 'L7L 4C4' });
    expect(splitLocation('Rocky View Co, AB T1Z0E7')).toEqual({ city: 'Rocky View Co', province: 'AB', postalCode: 'T1Z 0E7' });
    expect(looksLikeLocation('267 Rue Saint-Zotique O')).toBe(true);
    expect(looksLikeLocation('Montreal, QC H2V1A4')).toBe(true);
    expect(looksLikeLocation('PO Box 10')).toBe(true);
    expect(looksLikeLocation('Chris Ackerman')).toBe(false);
    expect(looksLikeLocation('Jean-François Tremblay')).toBe(false);
    expect(looksLikePersonalName('Kristy Cameron')).toBe(true);
    expect(looksLikePersonalName('Ackerman Painting')).toBe(false);
    expect(looksLikePersonalName('Dispatch Coffee')).toBe(false);
  });

  it('lifts tagged JSON into its own columns and keeps the note as evidence', () => {
    const row = expandRecord({ notes: META({ streetAddress: '1 Main St', nested: { deep: 'x' }, list: [1, 2] }), raw: '{"a":1}', secret: 'no' });
    expect(row['meta.streetAddress']).toBe('1 Main St');
    expect(row['meta.nested.deep']).toBe('x');
    expect(row['meta.list']).toBe('[1,2]');
    expect(row['raw.a']).toBe('1');
    expect(row.notes.startsWith('[NF_LEAD_META]')).toBe(true);
  });
});

describe('discovery and interpretations', () => {
  it('finds the concepts, the nested columns, and proposes only interpretations the rows support', () => {
    const parsed = parseCsv(csv([ROWS.ackerman, ROWS.ackermanSecond, ROWS.custom]));
    const discovery = discoverSource(expandRows(parsed.rows), parsed.headers);
    expect(discovery.mapping).toMatchObject({ business_name: 'business_name', person_name: 'full_name', phone: 'phone_e164', email: 'contact_email', street_address: 'meta.streetAddress', address_location: 'meta.cityOrLocation', contact_title: 'meta.contactTitle', estimated_revenue: 'meta.salesVolume', employee_count: 'meta.employees', source_id: 'id' });
    expect(discovery.nestedColumns).toContain('meta.cityOrLocation');
    expect(discovery.counts).toMatchObject({ businesses: 3, people: 3, phones: 3 });
    const proposals = proposeInterpretations(discovery, expandRows(parsed.rows));
    expect(proposals.map((proposal) => proposal.id)).toEqual(['extract_nested', 'merge_person_names', 'split_location', 'interpret_contact_role', 'link_person_business', 'group_businesses', 'format_phone']);
    expect(proposals.find((proposal) => proposal.id === 'group_businesses')?.affectedRows).toBe(2);
    expect(proposals.find((proposal) => proposal.id === 'split_location')?.examples[0]).toMatchObject({ 'meta.cityOrLocation': 'Burlington, ON L7L4C4' });
    const columns = discovery.columns.map((column) => column.name);
    const plan = defaultPlan(discovery, proposals);
    expect(validatePlan(plan, columns)).toEqual(plan);
    // A source-wide plan is not a custom column in the ordinary row normalizer.
    const columnRow = normalizeImportRow([...translationMappingFields(plan), { sourceColumn: 'business_name', target: { kind: 'core', field: 'name' }, transform: 'none' }], [], { business_name: 'Acme', '*': 'whole-source plan' });
    expect(columnRow.normalized).toMatchObject({ name: 'Acme', custom: {} });
    expect(columnRow.validationErrors).toEqual([]);
    expect(interpretationConflicts({ ...plan.decisions, extract_nested: 'rejected' }, plan.mapping)).toMatch(/embedded/);
    expect(() => validatePlan({ ...plan, mapping: { ...plan.mapping, email: 'password' } }, [...columns, 'password'])).toThrow(/credential/);
    expect(() => validatePlan({ ...plan, mapping: { business_name: 'missing' } }, columns)).toThrow(/no column/);
  });

  it('never proposes a person without a person column and never links without both', () => {
    const parsed = parseCsv('company,phone\nAcme,4165550100\n');
    const inspection = inspectRows(parsed);
    expect(inspection.interpretations.map((proposal) => proposal.id)).toEqual(['format_phone']);
    expect(inspection.summary).toMatchObject({ businesses: { total: 1 }, people: { total: 0 }, affiliations: 0 });
  });
});

describe('translation', () => {
  it('reads one business with one person, their link, the address and the telephone on the business', () => {
    const run = inspect([ROWS.ackerman]);
    const record = run.result.records[0];
    expect(record.business).toMatchObject({ name: 'Ackerman Painting', industry: 'Painters', website: 'https://ackermanpainting.example', estimatedRevenue: '402000', estimatedEmployees: '4', eligibility: 'ready' });
    expect(record.person).toMatchObject({ name: 'Chris Ackerman', email: 'chris@ackerman.example', phone: '', eligibility: 'ready' });
    expect(record.affiliation).toEqual({ role: 'Owner', state: 'proposed', issues: [] });
    expect(record.address).toMatchObject({ street: '5242 Cherryhill Cres', city: 'Burlington', province: 'ON', postalCode: 'L7L 4C4', kind: 'street_unverified' });
    expect(record.channels).toEqual([{ type: 'phone', e164: '+19054664554', display: '(905) 466-4554', owner: 'business', ownershipVerified: false }]);
    expect(record.evidence).toContainEqual({ concept: 'City, province and postal code together', sourceColumn: 'meta.cityOrLocation', originalValue: 'Burlington, ON L7L4C4', translatedValue: 'Burlington, ON, L7L 4C4', interpretation: 'split_location' });
    expect(record.issues).toEqual([]);
    expect(run.staging.businesses).toHaveLength(1);
    expect(run.staging.people).toHaveLength(1);
    const company = business(run, 'Ackerman Painting');
    expect(company.normalized).toMatchObject({ contact_type: 'company', phone: '+19054664554', email: null, custom: { industry: 'Painters', website: 'https://ackermanpainting.example', estimated_revenue: 402000, estimated_employees: 4, postal_code: 'L7L 4C4', lead_status: 'NEW' }, location: { address: '5242 Cherryhill Cres', city: 'Burlington', province: 'ON' } });
    const owner = person(run, 'Chris Ackerman');
    expect(owner.normalized).toMatchObject({ contact_type: 'person', email: 'chris@ackerman.example', phone: null, company_source_key: company.key, affiliation_title: 'Owner', location: { address: null, city: null, province: null } });
    expect(owner.normalized.translation.business).toEqual({ name: 'Ackerman Painting', sourceKey: company.key });
    expect(owner.hold).toBe(false);
  });

  it('reads one business with several people as one business, with every person linked to it', () => {
    const run = inspect([ROWS.ackerman, ROWS.ackermanSecond, ROWS.ackermanThird]);
    expect(run.result.summary).toMatchObject({ rows: 3, businesses: { total: 1, ready: 1, review: 0 }, people: { total: 2 }, affiliations: 2 });
    const company = business(run, 'Ackerman Painting');
    expect(company.normalized.translation.sourceRefs).toEqual(['a1', 'a2', 'a3']);
    expect(person(run, 'Pat Ackerman').normalized).toMatchObject({ company_source_key: company.key, affiliation_title: 'Estimator' });
    expect(run.staging.people).toHaveLength(2);
  });

  it('keeps rows with the same business name but different details apart and holds them', () => {
    const other = { ...ROWS.ackerman, id: 'a9', phone_e164: '+14165550199', website: 'ackerman-toronto.example', notes: META({ cityOrLocation: 'Toronto, ON M5V2H1' }) };
    const run = inspect([ROWS.ackerman, other]);
    expect(run.staging.businesses).toHaveLength(2);
    for (const row of run.staging.businesses) {
      expect(row.hold).toBe(true);
      expect(row.normalized.translation.issues.map((issue) => issue.code)).toContain('possible_duplicate_business');
    }
    // With grouping rejected, every row is its own business and nothing is held for it.
    const apart = inspect([ROWS.ackerman, ROWS.ackermanSecond], (plan) => ({ ...plan, decisions: { ...plan.decisions, group_businesses: 'rejected' } }));
    expect(apart.staging.businesses).toHaveLength(2);
    expect(apart.staging.businesses.every((row) => !row.hold)).toBe(true);
  });

  it('keeps a valid business without a person, and a person without a business with their own telephone and address', () => {
    const run = inspect([ROWS.noPerson, ROWS.noBusiness]);
    expect(run.staging.businesses.map((row) => row.normalized.name)).toEqual(['Acme Plumbing']);
    expect(business(run, 'Acme Plumbing').normalized.location).toEqual({ address: '123 Main St', city: 'Toronto', province: 'ON' });
    const morgan = person(run, 'Morgan Example');
    expect(morgan.normalized).toMatchObject({ phone: '+15145550125', email: 'morgan@example.test', location: { address: null, city: 'Québec', province: 'QC' } });
    expect(morgan.normalized).not.toHaveProperty('company_source_key');
    expect(morgan.normalized.translation.phone).toEqual({ e164: '+15145550125', display: '(514) 555-0125', owner: 'person' });
    expect(run.result.records[1].affiliation).toBeNull();
  });

  it('never makes a person from a street address or a role from a postal location, and keeps the business ready', () => {
    const run = inspect([ROWS.dispatch]);
    const record = run.result.records[0];
    expect(record.person).toBeNull();
    expect(record.affiliation).toBeNull();
    expect(record.business).toMatchObject({ name: 'Dispatch Coffee', eligibility: 'ready' });
    expect(record.issues.map((issue) => issue.code)).toEqual(['person_name_is_location', 'contact_title_is_location']);
    expect(record.evidence).toContainEqual({ concept: 'Person name', sourceColumn: 'full_name', originalValue: '267 Rue Saint-Zotique O', translatedValue: '' });
    expect(run.staging.people).toHaveLength(0);
    expect(business(run, 'Dispatch Coffee').hold).toBe(false);
  });

  it('holds a business whose name reads as a person’s name or equals the person’s, and invents no other name', () => {
    const run = inspect([ROWS.personal]);
    const company = business(run, 'Kristy Cameron');
    expect(company.hold).toBe(true);
    expect(company.normalized.translation.issues.map((issue) => issue.code)).toEqual(['business_name_is_person']);
    expect(company.normalized.custom).toMatchObject({ website: 'https://cameroncontractingltd.example' });
    expect(run.staging.people.map((row) => row.normalized.name)).toEqual(['Kristy Cameron']);
    expect(person(run, 'Kristy Cameron').hold).toBe(false);
    // The same business with nobody named on the row: the name's shape alone holds it.
    const alone = inspect([{ ...ROWS.personal, full_name: '' }]);
    expect(business(alone, 'Kristy Cameron').normalized.translation.issues.map((issue) => issue.code)).toEqual(['business_name_looks_personal']);
    expect(describeQuality(alone.result.summary)).toContain('1 row: The business name reads as a person’s name');
    // A different person on the row says the business name is a trading name: not held for its shape.
    const trading = inspect([{ ...ROWS.personal, full_name: 'Alex Ng' }]);
    expect(business(trading, 'Kristy Cameron').hold).toBe(false);
    // A person who shares the family name does not settle it either way.
    const family = inspect([{ ...ROWS.personal, full_name: 'Dale Cameron' }]);
    expect(business(family, 'Kristy Cameron').normalized.translation.issues.map((issue) => issue.code)).toEqual(['business_name_looks_personal']);
  });

  it('puts a telephone on each business rather than on the people who share it', () => {
    const run = inspect([ROWS.sharedPhoneA, ROWS.sharedPhoneB]);
    expect(run.staging.businesses.map((row) => row.normalized.phone)).toEqual(['+16045550101', '+16045550101']);
    expect(run.staging.people.map((row) => row.normalized.phone)).toEqual([null, null]);
    expect(run.staging.businesses.map((row) => row.normalized.translation.phone?.owner)).toEqual(['business', 'business']);
  });

  it('holds a source marked bad data and keeps do-not-call as a restriction on the business, never as consent', () => {
    const run = inspect([ROWS.bad]);
    const company = business(run, 'Willow Services');
    expect(company.hold).toBe(true);
    expect(company.normalized.custom).toMatchObject({ do_not_call: true, lead_status: 'BAD_DATA', postal_code: 'K1A 0A1' });
    expect(company.normalized.translation.restrictions).toEqual({ doNotCall: true, legacyStatus: 'BAD_DATA' });
    expect(company.normalized.translation.address?.kind).toBe('mailing_po_box');
    expect(person(run, 'Taylor Example').hold).toBe(true);
    const omitted = inspect([ROWS.bad], (plan) => ({ ...plan, suppression: 'omit' }));
    expect(business(omitted, 'Willow Services').normalized.custom).not.toHaveProperty('do_not_call');
    expect(business(omitted, 'Willow Services').hold).toBe(true);
  });

  it('reads embedded details only while that interpretation is approved', () => {
    const rejected = inspect([ROWS.ackerman], (plan) => ({ ...plan, decisions: { ...plan.decisions, extract_nested: 'rejected', split_location: 'rejected', interpret_contact_role: 'rejected' } }));
    const record = rejected.result.records[0];
    expect(record.address).toBeNull();
    expect(record.business?.estimatedRevenue).toBe('');
    expect(record.affiliation).toEqual({ role: '', state: 'proposed', issues: [] });
    expect(() => validatePlan({ ...rejected.plan, decisions: { ...rejected.plan.decisions, split_location: 'approved' } }, rejected.inspection.discovery.columns.map((column) => column.name))).toThrow(/embedded/);
  });

  it('keeps an unrecognized column only when the plan names a field for it, and says so otherwise', () => {
    const kept = inspect([ROWS.custom], (plan) => ({ ...plan, extraFields: { colour: 'colour' } }));
    expect(business(kept, 'Cedar Workshop').normalized.custom).toMatchObject({ colour: 'Teal' });
    const undefinedField = inspect([ROWS.custom], (plan) => ({ ...plan, extraFields: { colour: 'paint_colour' } }));
    expect(business(undefinedField, 'Cedar Workshop').normalized.custom).not.toHaveProperty('paint_colour');
    expect(business(undefinedField, 'Cedar Workshop').normalized.translation.issues).toContainEqual({ code: 'field_not_defined', detail: 'paint_colour' });
    expect(business(undefinedField, 'Cedar Workshop').raw.colour).toBe('Teal');
  });

  it('stages a row with neither name as rejected, never as a contact', () => {
    const run = inspect([ROWS.empty]);
    expect(run.staging.businesses).toHaveLength(0);
    expect(run.staging.people).toHaveLength(1);
    expect(run.staging.people[0]).toMatchObject({ validation_errors: ['No business or person name on this row.'], hold: false });
    expect(run.staging.people[0].normalized.translation.entity).toBe('row');
    expect(run.result.summary.blockedRows).toBe(1);
  });

  it('gives the same source the same keys every time, scoped to the file name', () => {
    const first = inspect([ROWS.ackerman, ROWS.ackermanSecond]);
    const again = inspect([ROWS.ackermanSecond, ROWS.ackerman]);
    expect(business(again, 'Ackerman Painting').key).toBe(business(first, 'Ackerman Painting').key);
    expect(person(again, 'Pat Ackerman').key).toBe(person(first, 'Pat Ackerman').key);
    expect(first.staging.rows.map((row) => row.key)).toSatisfy((keys: string[]) => keys.every((key) => /^[0-9a-f]{64}:(id|row):(business|person|row):.+$/.test(key)));
    const renamed = stagingRowsForTranslation(translateSource(expandRows(first.parsed.rows), first.plan), { sourceName: 'other.csv', plan: first.plan, definitions });
    expect(renamed.businesses[0].key).not.toBe(business(first, 'Ackerman Painting').key);
    expect(JSON.stringify(first.staging.rows)).toBe(JSON.stringify(inspect([ROWS.ackerman, ROWS.ackermanSecond]).staging.rows));
  });
});

describe('the Workbench flat package', () => {
  const flat = [
    'source_ref,record_status,quality_issues,business_ref,business_name,business_industry,business_sic_code,business_website,business_estimated_revenue,business_estimated_employees,person_ref,person_name,person_email,affiliation_role,affiliation_relationship,affiliation_verified,street_address,city,province,postal_code,address_type,address_verified,phone_e164,phone_display,phone_owner,phone_ownership_verified',
    'abc:1,ready,,business:abc:1,Ackerman Painting,Painters,1721-01,https://ackerman.example,402000,4,person:abc:1,Chris Ackerman,,Owner,candidate_associated_contact,false,5242 Cherryhill Cres,Burlington,ON,L7L 4C4,street_unverified,false,+19054664554,(905) 466-4554,unassigned,false',
    'abc:2,review,legacy_bad_data|duplicate_phone,business:abc:2,Acme Plumbing,,,,,,,,,,,,123 Main St,Toronto,ON,M5V 2H1,street_unverified,false,+14165550120,(416) 555-0120,unassigned,false',
  ].join('\n');

  it('is recognized by its columns, read by its stable reference, and keeps its review flags as holds', () => {
    const parsed = parseCsv(flat);
    expect(isWorkbenchFlatPackage(parsed.headers)).toBe(true);
    const inspection = inspectRows(parsed);
    expect(inspection.discovery.workbenchPackage).toBe(true);
    expect(inspection.plan.mapping).toMatchObject({ source_id: 'source_ref', business_name: 'business_name', person_name: 'person_name', contact_title: 'affiliation_role', phone: 'phone_e164' });
    const { staging } = prepareTranslatedImport(expandRows(parsed.rows), { sourceName: 'contacts_flat.csv', plan: inspection.plan, definitions });
    expect(staging.businesses.map((row) => [row.normalized.name, row.hold])).toEqual([['Ackerman Painting', false], ['Acme Plumbing', true]]);
    expect(staging.businesses[1].normalized.translation.issues).toContainEqual({ code: 'prior_review', detail: 'legacy_bad_data, duplicate_phone' });
    expect(staging.people[0].normalized).toMatchObject({ name: 'Chris Ackerman', affiliation_title: 'Owner', company_source_key: staging.businesses[0].key });
    expect(staging.people[0].key).toContain(':id:person:abc:1');
  });
});

describe('the saved plan', () => {
  it('is the one field of a translated mapping, and a column mapping still needs a Name', async () => {
    const plan = inspect([ROWS.ackerman]).plan;
    const fields = translationMappingFields(plan);
    expect(translationPlanOf(fields)).toEqual(plan);
    expect(translationPlanOf([{ sourceColumn: 'name', target: { kind: 'core', field: 'name' }, transform: 'none' }])).toBeNull();
    const db = { rpc: async () => ({ data: 'id', error: null }), auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) } } as never;
    await expect(createMapping(db, { organizationId: 'o', resourceId: 'r', fields: [...fields, ...fields] })).rejects.toThrow(/whole source/);
    await expect(createMapping(db, { organizationId: 'o', resourceId: 'r', fields: [{ sourceColumn: 'x', target: { kind: 'ignore' }, transform: 'none' }] })).rejects.toThrow(/Name/);
  });
});
