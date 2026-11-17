import { CONCEPT_LABELS, type Concept } from './discovery';
import type { InterpretationId } from './interpretations';
import {
  addressKind, isDoNotCallWord, isTrueWord, keyNorm, looksLikeLocation, looksLikePersonalName, normalizeAmount, normalizeEmail,
  normalizePhone, normalizePostalCode, normalizeWebsite, normalizeWholeNumber, phoneDisplay, plain, postalConflictsWithProvince,
  splitLocation, PROVINCES, type AddressKind,
} from './normalize';
import type { TranslationPlan } from './plan';

/**
 * Translation: one source row becomes candidate entities — a Business, a Person, the link between
 * them, an address and a telephone — each judged on its own. A valid business is not rejected
 * because the person on its row is an address; an uncertain link stays proposed; nothing is
 * invented. Every translated value keeps the column and value it came from.
 */

export const ISSUES = {
  missing_identity: { label: 'No business or person name', effect: 'blocks', about: 'row' },
  person_name_is_location: { label: 'The person name is an address, so no person is created', effect: 'notes', about: 'person' },
  contact_title_is_location: { label: 'The title is a location, so no role is recorded', effect: 'notes', about: 'affiliation' },
  title_is_industry: { label: 'The title repeats the industry, so no role is recorded', effect: 'notes', about: 'affiliation' },
  business_name_looks_personal: { label: 'The business name reads as a person’s name', effect: 'holds', about: 'business' },
  business_name_is_person: { label: 'The business and the person share one name; may be a sole proprietor', effect: 'holds', about: 'business' },
  website_invalid: { label: 'The website address cannot be read and is left out', effect: 'notes', about: 'business' },
  website_is_legal_notice: { label: 'The website column holds a legal notice and is left out', effect: 'notes', about: 'business' },
  website_is_directory: { label: 'The website is a directory listing, not the business’s own site', effect: 'notes', about: 'business' },
  phone_invalid: { label: 'The telephone number cannot be read and is left out', effect: 'notes', about: 'phone' },
  email_invalid: { label: 'The email address cannot be read and is left out', effect: 'notes', about: 'person' },
  postal_invalid: { label: 'The postal code cannot be read and is left out', effect: 'notes', about: 'address' },
  postal_province_conflict: { label: 'The postal code and the province disagree', effect: 'holds', about: 'address' },
  province_conflict: { label: 'Two columns give different provinces', effect: 'holds', about: 'address' },
  employees_invalid: { label: 'The employee count is not a number and is left out', effect: 'notes', about: 'business' },
  revenue_invalid: { label: 'The revenue is not an amount and is left out', effect: 'notes', about: 'business' },
  legacy_bad_data: { label: 'Marked as bad data in the source', effect: 'holds', about: 'row' },
  do_not_call: { label: 'Marked do not call in the source; kept as a restriction, never as consent', effect: 'notes', about: 'row' },
  possible_duplicate_business: { label: 'Another row names this business with different details', effect: 'holds', about: 'business' },
  conflicting_details: { label: 'Rows for this business give different details; the first is kept', effect: 'notes', about: 'business' },
  prior_review: { label: 'Flagged for review in the Workbench export', effect: 'holds', about: 'row' },
  field_not_defined: { label: 'No field exists for this value, so it stays with the source row', effect: 'notes', about: 'business' },
} as const satisfies Record<string, { label: string; effect: 'blocks' | 'holds' | 'notes'; about: 'row' | 'business' | 'person' | 'affiliation' | 'address' | 'phone' }>;

export type IssueCode = keyof typeof ISSUES;
export type Issue = { code: IssueCode; detail?: string };
export type Eligibility = 'ready' | 'review' | 'blocked';

export type Evidence = {
  concept: string;
  sourceColumn: string;
  originalValue: string;
  translatedValue: string;
  /** The interpretation that produced the reading, when one did. */
  interpretation?: InterpretationId;
};

export type BusinessCandidate = {
  name: string;
  industry: string;
  sicCode: string;
  website: string;
  websiteHost: string;
  estimatedRevenue: string;
  estimatedEmployees: string;
  eligibility: Eligibility;
  issues: Issue[];
};

export type PersonCandidate = {
  name: string;
  email: string;
  /** Only when the row has no business: a business row's number is the business's. */
  phone: string;
  eligibility: Eligibility;
  issues: Issue[];
};

export type AffiliationCandidate = { role: string; state: 'proposed'; issues: Issue[] };
export type AddressCandidate = { street: string; city: string; province: string; postalCode: string; kind: AddressKind; issues: Issue[] };
export type ChannelCandidate = { type: 'phone'; e164: string; display: string; owner: 'business' | 'person'; ownershipVerified: false };

export type TranslatedRecord = {
  index: number;
  /** The source's own ID when it has one; the stable reference otherwise comes from the row's content. */
  sourceId: string | null;
  raw: Record<string, string>;
  business: BusinessCandidate | null;
  person: PersonCandidate | null;
  affiliation: AffiliationCandidate | null;
  address: AddressCandidate | null;
  channels: ChannelCandidate[];
  evidence: Evidence[];
  issues: Issue[];
  restrictions: { doNotCall: boolean; legacyStatus: string };
  /** Values from unrecognized columns the plan keeps, by custom field key. */
  extras: Record<string, string>;
};

const effectOf = (issue: Issue) => ISSUES[issue.code].effect;

function eligibilityFrom(name: string, issues: Issue[]): Eligibility {
  if (!name) return 'blocked';
  return issues.some((issue) => effectOf(issue) === 'holds') ? 'review' : 'ready';
}

/** Translates one expanded source row under a plan. Pure and deterministic: the same row and plan always give the same record. */
export function translateRecord(raw: Record<string, string>, index: number, plan: TranslationPlan): TranslatedRecord {
  const approved = (id: InterpretationId) => plan.decisions[id] === 'approved';
  const nestedAllowed = approved('extract_nested');
  const read = (concept: Concept): string => {
    const column = plan.mapping[concept];
    if (!column) return '';
    if (column.startsWith('meta.') && !nestedAllowed) return '';
    return plain(raw[column]);
  };
  const evidence: Evidence[] = [];
  const note = (concept: Concept | string, column: string | undefined, original: string, translated: string, interpretation?: InterpretationId) => {
    if (!column || !original) return;
    const label = (CONCEPT_LABELS as Record<string, string>)[concept] ?? concept;
    evidence.push({ concept: label, sourceColumn: column, originalValue: original.slice(0, 500), translatedValue: translated.slice(0, 500), ...(interpretation ? { interpretation } : {}) });
  };
  const rowIssues: Issue[] = [];
  const businessIssues: Issue[] = [];
  const personIssues: Issue[] = [];
  const affiliationIssues: Issue[] = [];
  const addressIssues: Issue[] = [];

  // Restrictions and prior review come first: they hold the whole row whatever else it holds.
  const legacyStatus = read('legacy_status').toUpperCase();
  const doNotCall = isTrueWord(read('do_not_call')) || isDoNotCallWord(legacyStatus);
  if (legacyStatus === 'BAD_DATA') rowIssues.push({ code: 'legacy_bad_data' });
  if (doNotCall) rowIssues.push({ code: 'do_not_call' });
  if (plan.mapping.source_id === 'source_ref' && 'quality_issues' in raw) {
    const prior = plain(raw.quality_issues).split('|').map((item) => item.trim()).filter((item) => item && item !== 'do_not_call');
    if (plain(raw.record_status) === 'review' || prior.length) rowIssues.push({ code: 'prior_review', detail: prior.join(', ') || 'record_status=review' });
  }

  // Business.
  const businessName = read('business_name');
  let business: BusinessCandidate | null = null;
  if (businessName) {
    const website = normalizeWebsite(read('website'));
    if (website.issue) businessIssues.push({ code: website.issue });
    const employees = read('employee_count');
    const estimatedEmployees = normalizeWholeNumber(employees);
    if (employees && !estimatedEmployees) businessIssues.push({ code: 'employees_invalid' });
    const revenue = read('estimated_revenue');
    const estimatedRevenue = normalizeAmount(revenue);
    if (revenue && !estimatedRevenue) businessIssues.push({ code: 'revenue_invalid' });
    business = { name: businessName, industry: read('industry'), sicCode: read('sic_code'), website: website.value, websiteHost: website.host, estimatedRevenue, estimatedEmployees, eligibility: 'ready', issues: businessIssues };
    note('business_name', plan.mapping.business_name, businessName, businessName);
    note('industry', plan.mapping.industry, read('industry'), business.industry);
    note('sic_code', plan.mapping.sic_code, read('sic_code'), business.sicCode);
    note('website', plan.mapping.website, read('website'), website.value);
    note('estimated_revenue', plan.mapping.estimated_revenue, revenue, estimatedRevenue);
    note('employee_count', plan.mapping.employee_count, employees, estimatedEmployees);
  }

  // Person. An address in the name column is evidence about the row, never a person.
  let personName = read('person_name');
  let personColumn = plan.mapping.person_name;
  if (personName && looksLikeLocation(personName)) {
    personIssues.push({ code: 'person_name_is_location', detail: personName });
    note('person_name', personColumn, personName, '');
    personName = '';
  }
  if (!personName && approved('merge_person_names')) {
    for (const alternate of ['owner_name', 'contact_name', 'full_name']) {
      const candidate = plain(raw[alternate]);
      if (candidate && alternate !== plan.mapping.person_name && !looksLikeLocation(candidate)) { personName = candidate; personColumn = alternate; break; }
    }
  }
  let person: PersonCandidate | null = null;
  if (personName) {
    const email = normalizeEmail(read('email'));
    if (!email.valid) personIssues.push({ code: 'email_invalid' });
    person = { name: personName, email: email.value, phone: '', eligibility: 'ready', issues: personIssues };
    note('person_name', personColumn, personName, personName, personColumn !== plan.mapping.person_name ? 'merge_person_names' : undefined);
    note('email', plan.mapping.email, read('email'), email.value);
    if (business && keyNorm(business.name) === keyNorm(personName)) businessIssues.push({ code: 'business_name_is_person' });
  }
  // A business name that reads as a person's name is held when nothing on the row says otherwise:
  // no person named, or a person who shares the name. A different person on the row is evidence
  // the business name is a trading name, so it is not held on the name's shape alone.
  if (business && looksLikePersonalName(business.name) && keyNorm(business.name) !== keyNorm(personName)
      && (!personName || sharesName(business.name, personName))) {
    businessIssues.push({ code: 'business_name_looks_personal' });
  }
  if (!business && !person) rowIssues.push({ code: 'missing_identity' });

  // Role and the proposed link.
  let role = '';
  const title = read('contact_title');
  if (title) {
    if (looksLikeLocation(title)) affiliationIssues.push({ code: 'contact_title_is_location', detail: title });
    else if (business && keyNorm(title) === keyNorm(business.industry)) affiliationIssues.push({ code: 'title_is_industry' });
    else if (/\(\d{3,6}-\d{1,3}\)/.test(title)) affiliationIssues.push({ code: 'title_is_industry' });
    else role = title;
  }
  let affiliation: AffiliationCandidate | null = null;
  if (business && person && approved('link_person_business')) {
    const linkedRole = approved('interpret_contact_role') ? role : '';
    affiliation = { role: linkedRole, state: 'proposed', issues: affiliationIssues };
    note('contact_title', plan.mapping.contact_title, title, linkedRole, 'interpret_contact_role');
  } else if (title) {
    note('contact_title', plan.mapping.contact_title, title, '');
  }

  // Address: the business's, or the person's when the row has no business.
  let address: AddressCandidate | null = null;
  const street = read('street_address');
  const combined = approved('split_location') ? splitLocation(read('address_location')) : { city: '', province: '', postalCode: '' };
  const directProvince = read('province').toUpperCase();
  const city = read('city') || combined.city;
  let province = directProvince || combined.province;
  if (province && !(PROVINCES as readonly string[]).includes(province) && combined.province) province = combined.province;
  const rawPostal = read('postal_code');
  const postalCode = normalizePostalCode(rawPostal) || combined.postalCode || rawPostal;
  if (rawPostal && !normalizePostalCode(rawPostal) && /^[A-Za-z]\d/.test(rawPostal)) addressIssues.push({ code: 'postal_invalid' });
  if (directProvince && combined.province && directProvince !== combined.province) addressIssues.push({ code: 'province_conflict', detail: `${directProvince} and ${combined.province}` });
  if (postalConflictsWithProvince(postalCode, province)) addressIssues.push({ code: 'postal_province_conflict', detail: `${postalCode} is not in ${province}` });
  if ((business || person) && (street || city || postalCode)) {
    address = { street, city, province, postalCode, kind: addressKind(street), issues: addressIssues };
    note('street_address', plan.mapping.street_address, street, street);
    note('address_location', plan.mapping.address_location, read('address_location'), [combined.city, combined.province, combined.postalCode].filter(Boolean).join(', '), 'split_location');
    note('city', plan.mapping.city, read('city'), city);
    note('province', plan.mapping.province, read('province'), province);
    note('postal_code', plan.mapping.postal_code, rawPostal, postalCode);
  }

  // Telephone: the business's where a business exists; whose desk it reaches is not known.
  const channels: ChannelCandidate[] = [];
  const rawPhone = read('phone');
  const e164 = normalizePhone(rawPhone);
  if (rawPhone && !e164) (business ?? person)?.issues.push({ code: 'phone_invalid' });
  if (e164 && (business || person)) {
    channels.push({ type: 'phone', e164, display: approved('format_phone') ? phoneDisplay(e164) : e164, owner: business ? 'business' : 'person', ownershipVerified: false });
    if (!business && person) person.phone = e164;
    note('phone', plan.mapping.phone, rawPhone, e164, 'format_phone');
  }

  const extras: Record<string, string> = {};
  for (const [column, key] of Object.entries(plan.extraFields)) {
    const value = plain(raw[column]);
    if (value) { extras[key] = value; note(column, column, value, value); }
  }

  // Each entity is judged on its own; a row-level hold reaches every entity on the row.
  const rowHolds = rowIssues.filter((issue) => effectOf(issue) === 'holds');
  if (business) { business.issues = [...businessIssues, ...addressIssues.filter((issue) => effectOf(issue) === 'holds'), ...rowHolds]; business.eligibility = eligibilityFrom(business.name, business.issues); }
  if (person) { person.issues = [...personIssues, ...(!business ? addressIssues.filter((issue) => effectOf(issue) === 'holds') : []), ...rowHolds]; person.eligibility = eligibilityFrom(person.name, person.issues); }
  const issues = dedupe([...rowIssues, ...businessIssues, ...personIssues, ...affiliationIssues, ...addressIssues]);
  const sourceId = read('source_id') || null;
  return { index, sourceId, raw, business, person, affiliation, address, channels, evidence, issues, restrictions: { doNotCall, legacyStatus }, extras };
}

/** Whether two names share a first or last word, as "Kristy Cameron" and "Cameron Contracting" do. */
function sharesName(a: string, b: string): boolean {
  const wordsA = a.toLowerCase().split(/\s+/);
  const wordsB = b.toLowerCase().split(/\s+/);
  return wordsA[0] === wordsB[0] || wordsA[wordsA.length - 1] === wordsB[wordsB.length - 1];
}

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => { const key = `${issue.code}:${issue.detail ?? ''}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** One business across the rows that describe it. Its people are the people on those rows. */
export type BusinessGroup = {
  /** Stable within the source: the name plus the detail that distinguishes it (website, telephone or city). */
  identityKey: string;
  candidate: BusinessCandidate;
  address: AddressCandidate | null;
  phone: ChannelCandidate | null;
  recordIndexes: number[];
  evidence: Evidence[];
  issues: Issue[];
  restrictions: { doNotCall: boolean; legacyStatus: string };
  extras: Record<string, string>;
};

export type TranslationResult = {
  records: TranslatedRecord[];
  businesses: BusinessGroup[];
  /** Which business group each record's business belongs to, by record index. */
  businessOf: Map<number, BusinessGroup>;
  summary: TranslationSummary;
};

export type TranslationSummary = {
  rows: number;
  businesses: { total: number; ready: number; review: number };
  people: { total: number; ready: number; review: number };
  affiliations: number;
  addresses: number;
  phones: number;
  blockedRows: number;
  issues: Partial<Record<IssueCode, number>>;
};

const EVIDENCE_LIMIT = 60;

/** Translates every row, then groups the rows that describe one business. */
export function translateSource(rows: Record<string, string>[], plan: TranslationPlan): TranslationResult {
  const records = rows.map((raw, index) => translateRecord(raw, index, plan));
  const grouping = plan.decisions.group_businesses === 'approved';
  const groups = new Map<string, BusinessGroup>();
  const byName = new Map<string, Set<string>>();
  const businessOf = new Map<number, BusinessGroup>();
  for (const record of records) {
    if (!record.business) continue;
    const nameKey = keyNorm(record.business.name);
    const phone = record.channels.find((channel) => channel.owner === 'business') ?? null;
    const discriminator = record.business.websiteHost || phone?.e164 || keyNorm(record.address?.city ?? '');
    const identityKey = grouping ? `${nameKey}|${discriminator}` : `row|${record.sourceId ?? String(record.index)}`;
    let group = groups.get(identityKey);
    if (!group) {
      group = {
        identityKey, candidate: { ...record.business, issues: [...record.business.issues] }, address: record.address, phone, recordIndexes: [],
        evidence: [], issues: [], restrictions: { ...record.restrictions }, extras: { ...record.extras },
      };
      groups.set(identityKey, group);
    } else {
      mergeInto(group, record, phone);
    }
    group.recordIndexes.push(record.index);
    group.evidence.push(...record.evidence.filter((item) => item.concept !== CONCEPT_LABELS.person_name && item.concept !== CONCEPT_LABELS.email && item.concept !== CONCEPT_LABELS.contact_title));
    businessOf.set(record.index, group);
    if (!byName.has(nameKey)) byName.set(nameKey, new Set());
    byName.get(nameKey)!.add(identityKey);
  }
  for (const group of groups.values()) {
    const nameKey = group.identityKey.split('|')[0];
    const siblings = grouping ? byName.get(nameKey) : null;
    if (siblings && siblings.size > 1) group.candidate.issues.push({ code: 'possible_duplicate_business', detail: `${siblings.size} rows with this name differ in website, telephone or city` });
    group.candidate.issues = dedupe(group.candidate.issues);
    group.candidate.eligibility = eligibilityFrom(group.candidate.name, group.candidate.issues);
    group.issues = group.candidate.issues;
    if (group.evidence.length > EVIDENCE_LIMIT) group.evidence = group.evidence.slice(0, EVIDENCE_LIMIT);
  }
  const businesses = [...groups.values()];
  const people = records.filter((record) => record.person);
  const summary: TranslationSummary = {
    rows: records.length,
    businesses: { total: businesses.length, ready: businesses.filter((group) => group.candidate.eligibility === 'ready').length, review: businesses.filter((group) => group.candidate.eligibility === 'review').length },
    people: { total: people.length, ready: people.filter((record) => record.person!.eligibility === 'ready').length, review: people.filter((record) => record.person!.eligibility === 'review').length },
    affiliations: records.filter((record) => record.affiliation).length,
    addresses: businesses.filter((group) => group.address).length + records.filter((record) => !record.business && record.address).length,
    phones: businesses.filter((group) => group.phone).length + records.filter((record) => !record.business && record.channels.length).length,
    blockedRows: records.filter((record) => !record.business && !record.person).length,
    issues: {},
  };
  for (const record of records) for (const issue of record.issues) summary.issues[issue.code] = (summary.issues[issue.code] ?? 0) + 1;
  for (const group of businesses) if (group.candidate.issues.some((issue) => issue.code === 'possible_duplicate_business')) summary.issues.possible_duplicate_business = (summary.issues.possible_duplicate_business ?? 0) + 1;
  return { records, businesses, businessOf, summary };
}

/** Fills the group's blanks from a later row and notes, never resolves, a disagreement. */
function mergeInto(group: BusinessGroup, record: TranslatedRecord, phone: ChannelCandidate | null): void {
  const candidate = group.candidate;
  const incoming = record.business!;
  const conflicts: string[] = [];
  for (const field of ['industry', 'sicCode', 'website', 'websiteHost', 'estimatedRevenue', 'estimatedEmployees'] as const) {
    if (!candidate[field]) candidate[field] = incoming[field];
    else if (incoming[field] && incoming[field] !== candidate[field]) conflicts.push(field);
  }
  if (!group.address && record.address) group.address = record.address;
  else if (group.address && record.address && (record.address.street !== group.address.street || record.address.city !== group.address.city) && (record.address.street || record.address.city)) conflicts.push('address');
  if (!group.phone && phone) group.phone = phone;
  if (conflicts.length) candidate.issues.push({ code: 'conflicting_details', detail: conflicts.join(', ') });
  for (const issue of incoming.issues) candidate.issues.push(issue);
  group.restrictions.doNotCall = group.restrictions.doNotCall || record.restrictions.doNotCall;
  if (!group.restrictions.legacyStatus) group.restrictions.legacyStatus = record.restrictions.legacyStatus;
  for (const [key, value] of Object.entries(record.extras)) if (!group.extras[key]) group.extras[key] = value;
}

export function issueLabel(issue: Issue): string {
  const label = ISSUES[issue.code].label;
  return issue.detail ? `${label} (${issue.detail})` : label;
}
