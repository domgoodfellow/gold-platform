import type { SourceDiscovery } from './discovery';
import { keyNorm, normalizePhone, plain } from './normalize';

/**
 * Interpretations: the readings of a source a person approves or rejects before anything is
 * staged. Each is proposed only when the rows show evidence for it, carries that evidence, and
 * changes the translated result deterministically when approved. None is an AI claim.
 */

export const INTERPRETATION_IDS = [
  'extract_nested', 'merge_person_names', 'split_location', 'interpret_contact_role',
  'link_person_business', 'group_businesses', 'format_phone',
] as const;
export type InterpretationId = (typeof INTERPRETATION_IDS)[number];

export type InterpretationDecision = 'approved' | 'rejected';

const RULES: Record<InterpretationId, { title: string; concept: string; explanation: string; effect: string }> = {
  extract_nested: {
    title: 'Read details embedded in a text column',
    concept: 'Embedded details',
    explanation: 'JSON tagged inside a text column describes separate attributes. Read each as its own value while keeping the original note as evidence.',
    effect: 'Street, city, revenue, employees, industry and title found inside the note are translated; the note itself is not written to a contact.',
  },
  merge_person_names: {
    title: 'Treat repeated person-name columns as one person',
    concept: 'Person identity',
    explanation: 'Several columns name the same person in one row. Use the first and fall back to another when it is a name; never create a second person from the same row.',
    effect: 'One person per row where the columns agree. Conflicting names are held for review.',
  },
  split_location: {
    title: 'Split a combined location into city, province and postal code',
    concept: 'Address',
    explanation: 'A single value such as “Burlington, ON L7L 4C4” holds three parts. Each is read on its own and the original value is kept as evidence.',
    effect: 'One structured address per business with city, province and postal code where present.',
  },
  interpret_contact_role: {
    title: 'Read the contact title as the person’s role at the business',
    concept: 'Role',
    explanation: 'A title such as Owner or Manager describes the person’s relationship to the business, not a second name or a business attribute. Values that are a location or an industry are not roles.',
    effect: 'The role is placed on the proposed link between the person and the business.',
  },
  link_person_business: {
    title: 'Propose that the person belongs to the business on the same row',
    concept: 'Relationship',
    explanation: 'A person named on a business row is a candidate contact at that business. This proposes the link within the row only; it does not prove employment or ownership.',
    effect: 'Each person is linked to their row’s business when both are usable. The link is recorded as proposed, never verified.',
  },
  group_businesses: {
    title: 'Treat rows that describe the same business as one business',
    concept: 'Business identity',
    explanation: 'Rows with the same business name and the same website or telephone describe one business with several people. Rows with the same name but different details are kept apart and held for review.',
    effect: 'One business record per distinct business; its people are linked to it. Nothing is merged when the details disagree.',
  },
  format_phone: {
    title: 'Keep telephone numbers in one dialable form',
    concept: 'Telephone',
    explanation: 'Numbers are stored as +1 905 466 4554 for reliable matching and dialing and shown as (905) 466-4554. A number on a business row is the business’s number; whose desk it reaches is not known.',
    effect: 'Every telephone is stored in one form; numbers that cannot be read are reported rather than kept.',
  },
};

export type Interpretation = {
  id: InterpretationId;
  title: string;
  concept: string;
  explanation: string;
  effect: string;
  affectedRows: number;
  sources: string[];
  examples: Record<string, string>[];
  /** `direct`: the pattern is in the data. `inferred`: a reading of it a person should confirm. */
  evidenceType: 'direct' | 'inferred';
};

function examples(rows: Record<string, string>[], columns: string[], limit = 3): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const row of rows) {
    const entry: Record<string, string> = {};
    for (const column of columns) { const value = plain(row[column]); if (value) entry[column] = value.slice(0, 100); }
    if (Object.keys(entry).length) out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

/** Every interpretation the rows give evidence for, with that evidence. Order is fixed so decisions are stable. */
export function proposeInterpretations(discovery: SourceDiscovery, rows: Record<string, string>[]): Interpretation[] {
  const { mapping } = discovery;
  const found: Partial<Record<InterpretationId, { affected: number; sources: string[] }>> = {};
  const nested = discovery.nestedColumns.filter((column) => !discovery.columns.find((profile) => profile.name === column)?.sensitive);
  if (nested.length) found.extract_nested = { affected: rows.filter((row) => nested.some((column) => plain(row[column]))).length, sources: nested.slice(0, 7) };

  const nameColumns = discovery.columns.map((column) => column.name).filter((name) => ['fullname', 'ownername', 'contactname', 'personname'].includes(keyNorm(name)));
  if (mapping.person_name && nameColumns.length > 1) {
    const alternate = nameColumns.find((name) => name !== mapping.person_name);
    if (alternate) {
      const agree = rows.filter((row) => plain(row[mapping.person_name!]) && plain(row[alternate]) && keyNorm(plain(row[mapping.person_name!])) === keyNorm(plain(row[alternate]))).length;
      found.merge_person_names = { affected: agree, sources: [mapping.person_name, alternate] };
    }
  }
  if (mapping.address_location) found.split_location = { affected: rows.filter((row) => plain(row[mapping.address_location!])).length, sources: [mapping.address_location, mapping.street_address ?? ''].filter(Boolean) };
  if (mapping.contact_title) found.interpret_contact_role = { affected: rows.filter((row) => plain(row[mapping.contact_title!])).length, sources: [mapping.contact_title] };
  if (mapping.business_name && mapping.person_name) {
    found.link_person_business = { affected: rows.filter((row) => plain(row[mapping.business_name!]) && plain(row[mapping.person_name!])).length, sources: [mapping.business_name, mapping.person_name] };
    const seen = new Map<string, number>();
    for (const row of rows) { const key = keyNorm(plain(row[mapping.business_name!])); if (key) seen.set(key, (seen.get(key) ?? 0) + 1); }
    const repeated = [...seen.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
    if (repeated) found.group_businesses = { affected: repeated, sources: [mapping.business_name, mapping.website ?? '', mapping.phone ?? ''].filter(Boolean) };
  }
  if (mapping.phone) found.format_phone = { affected: rows.filter((row) => normalizePhone(row[mapping.phone!])).length, sources: [mapping.phone] };

  return INTERPRETATION_IDS.flatMap((id) => {
    const evidence = found[id];
    if (!evidence || !evidence.affected) return [];
    return [{
      id, ...RULES[id], affectedRows: evidence.affected, sources: evidence.sources,
      examples: examples(rows, evidence.sources.slice(0, 2)),
      evidenceType: id === 'extract_nested' || id === 'format_phone' ? 'direct' : 'inferred',
    } satisfies Interpretation];
  });
}

/** Rules that read nested values cannot be approved when reading nested values was rejected. */
export function interpretationConflicts(decisions: Partial<Record<InterpretationId, InterpretationDecision>>, mapping: SourceDiscovery['mapping']): string | null {
  if (decisions.extract_nested !== 'rejected') return null;
  const dependent: [InterpretationId, keyof typeof mapping][] = [['split_location', 'address_location'], ['interpret_contact_role', 'contact_title']];
  for (const [rule, concept] of dependent) {
    if (decisions[rule] === 'approved' && mapping[concept]?.startsWith('meta.')) {
      return `${RULES[rule].title} reads a value embedded in a text column. Approve reading embedded details, or reject that interpretation too.`;
    }
  }
  return null;
}
