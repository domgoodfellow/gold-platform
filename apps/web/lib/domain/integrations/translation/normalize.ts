/**
 * Deterministic value normalization for translated imports. Every function here is pure, takes
 * one source value and returns what the platform would store, plus (where it matters) why it
 * could not. Nothing is guessed: a value that cannot be read becomes empty and the caller records
 * the reason as a quality issue against the entity it would have described.
 *
 * Ported from the GuildOps Import Workbench v0.4.1 (`engine.py`, `source.py`, `semantic.py`), which
 * is kept as reference documentation under `docs/reference/import-workbench/`.
 */

export function plain(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return /^(null|none|nan)$/i.test(text) ? '' : text;
}

/** Letters and digits only, lowercased: the key two spellings of one column or name share. */
export function keyNorm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** E.164, or empty when the digits cannot be a number this platform dials. */
export function normalizePhone(value: unknown): string {
  const text = plain(value);
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (text.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

/** Presentation only: North American numbers in the familiar local form; anything else unchanged. */
export function phoneDisplay(e164: string): string {
  if (/^\+1\d{10}$/.test(e164)) {
    const digits = e164.slice(2);
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return e164;
}

export function normalizeEmail(value: unknown): { value: string; valid: boolean } {
  const text = plain(value).toLowerCase();
  if (!text) return { value: '', valid: true };
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text) ? { value: text, valid: true } : { value: '', valid: false };
}

const LEGAL_NOTICE = /(unsolicited\s+fax|unsolicited.*advertisements|advertisements.*fax|fax.*advertisement|telephone\s+consumer\s+protection)/i;
const DIRECTORY_HOSTS = ['yellowpages.', 'yelp.', 'facebook.', 'linkedin.', '411.ca', 'canpages.', 'mapquest.', 'bbb.org'];

export type WebsiteIssue = 'website_is_legal_notice' | 'website_invalid' | 'website_is_directory' | null;

/** A syntactically usable website address, never a verified one. */
export function normalizeWebsite(value: unknown): { value: string; host: string; issue: WebsiteIssue } {
  const text = plain(value);
  if (!text) return { value: '', host: '', issue: null };
  if (LEGAL_NOTICE.test(text)) return { value: '', host: '', issue: 'website_is_legal_notice' };
  const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let host = '';
  try {
    host = new URL(candidate).hostname.toLowerCase();
  } catch {
    return { value: '', host: '', issue: 'website_invalid' };
  }
  if (!host || !host.includes('.') || /[^a-z0-9.-]/.test(host) || host.includes('..') || host.startsWith('.') || host.endsWith('.')) {
    return { value: '', host: '', issue: 'website_invalid' };
  }
  return { value: candidate, host, issue: DIRECTORY_HOSTS.some((directory) => host.includes(directory)) ? 'website_is_directory' : null };
}

const POSTAL = /\b([ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][\s-]?\d[ABCEGHJ-NPRSTV-Z]\d)\b/i;
export const PROVINCES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'] as const;
const POSTAL_PROVINCE: Record<string, string> = { A: 'NL', B: 'NS', C: 'PE', E: 'NB', G: 'QC', H: 'QC', J: 'QC', K: 'ON', L: 'ON', M: 'ON', N: 'ON', P: 'ON', R: 'MB', S: 'SK', T: 'AB', V: 'BC', X: 'NT', Y: 'YT' };

/** `A1A 1A1`, or empty when the value is not a Canadian postal code. Other countries' codes are kept as typed by the caller. */
export function normalizePostalCode(value: unknown): string {
  const compact = plain(value).replace(/[\s-]/g, '').toUpperCase();
  if (!/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(compact)) return '';
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

/** Whether a Canadian postal code and a province disagree. Nunavut shares the X prefix with the Northwest Territories. */
export function postalConflictsWithProvince(postalCode: string, province: string): boolean {
  if (!postalCode || !province) return false;
  const expected = POSTAL_PROVINCE[postalCode[0]];
  if (!expected || expected === province) return false;
  return !(postalCode.startsWith('X0') && province === 'NU');
}

/** "Burlington, ON L7L 4C4" → city, province and postal code; each empty when absent. */
export function splitLocation(value: unknown): { city: string; province: string; postalCode: string } {
  const text = plain(value);
  if (!text) return { city: '', province: '', postalCode: '' };
  const postalMatch = POSTAL.exec(text);
  const postalCode = postalMatch ? normalizePostalCode(postalMatch[1]) : '';
  const remainder = (postalMatch ? text.slice(0, postalMatch.index) + text.slice(postalMatch.index + postalMatch[0].length) : text).replace(/^[\s,-]+|[\s,-]+$/g, '');
  const provinceMatch = new RegExp(`\\b(${PROVINCES.join('|')})\\b\\s*$`, 'i').exec(remainder);
  const province = provinceMatch ? provinceMatch[1].toUpperCase() : '';
  const city = (provinceMatch ? remainder.slice(0, provinceMatch.index) : remainder).replace(/^[\s,-]+|[\s,-]+$/g, '');
  return { city, province, postalCode };
}

const STREET_WORDS = '(?:rue|avenue|av\\.?|boul(?:evard)?\\.?|chemin|ch\\.?|route|rang|place|croissant|cresc?\\.?|street|st\\.?|road|rd\\.?|drive|dr\\.?|lane|ln\\.?|court|ct\\.?|way|trail|terrace|ter\\.?|blvd\\.?|highway|hwy\\.?|parkway|pkwy\\.?|boulevard|circle|cir\\.?)';
const PROVINCE_WORD = `(?:${PROVINCES.join('|')})`;

/**
 * Whether a value is a street address, a city-and-postal string or a box number rather than a
 * name. Deliberately narrow: a numbered street or a postal pattern, never a guess from any two
 * capitalized words. The source value stays available verbatim; only its reading as a name changes.
 */
export function looksLikeLocation(value: unknown): boolean {
  const text = plain(value);
  if (!text || text.length > 180) return false;
  if (POSTAL.test(text) && (text.includes(',') || new RegExp(`\\b${PROVINCE_WORD}\\b`, 'i').test(text))) return true;
  if (new RegExp(`,\\s*${PROVINCE_WORD}\\s*$`, 'i').test(text)) return true;
  if (/^\s*(?:P\.?\s*O\.?\s*Box|Postal Box|C\.?\s*P\.?)\s+\d+/i.test(text)) return true;
  if (new RegExp(`^\\s*\\d{1,7}(?:[-/]\\d{1,7})?\\s+${STREET_WORDS}\\b`, 'i').test(text)) return true;
  if (new RegExp(`^\\s*\\d{1,7}(?:[-/]\\d{1,7})?\\s+.{1,85}\\s+${STREET_WORDS}\\b`, 'i').test(text)) return true;
  return false;
}

/** A whole number as text, or empty. */
export function normalizeWholeNumber(value: unknown): string {
  const text = plain(value).replace(/,/g, '');
  return /^\d+$/.test(text) ? String(Number.parseInt(text, 10)) : '';
}

/** A reported amount with no currency assumed, or empty. */
export function normalizeAmount(value: unknown): string {
  const text = plain(value).replace(/,/g, '').replace(/\$/g, '').trim();
  return /^\d+(?:\.\d{1,2})?$/.test(text) ? text : '';
}

export type AddressKind = 'street_unverified' | 'mailing_po_box' | 'unknown';

export function addressKind(street: string): AddressKind {
  if (/\b(?:p\.?\s*o\.?\s*box|postal\s+box|post\s+office\s+box|c\.?\s*p\.?\s+\d)/i.test(street)) return 'mailing_po_box';
  return street ? 'street_unverified' : 'unknown';
}

export function isDoNotCallWord(value: unknown): boolean {
  const compact = plain(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ['DNC', 'DONOTCALL', 'NOCALL', 'OPTOUT'].includes(compact);
}

export function isTrueWord(value: unknown): boolean {
  return ['1', 'true', 't', 'yes', 'y'].includes(plain(value).toLowerCase());
}

const BUSINESS_WORDS = new RegExp('\\b(' + [
  'inc', 'ltd', 'ltée', 'llc', 'corp', 'co', 'company', 'limited', 'incorporated', 'enterprises?', 'services?', 'group', 'solutions', 'consulting',
  'consultants', 'contracting', 'contractors?', 'construction', 'plumbing', 'plumbers', 'electric', 'electrical', 'electricians', 'roofing', 'roofers',
  'painting', 'painters', 'landscaping', 'landscapes?', 'cleaning', 'cleaners', 'janitorial', 'auto', 'automotive', 'motors', 'garage', 'collision',
  'tires?', 'towing', 'clinic', 'dental', 'dentistry', 'medical', 'health', 'care', 'wellness', 'physio', 'massage', 'chiropractic', 'optical',
  'pharmacy', 'veterinary', 'kennel', 'grooming', 'law', 'legal', 'associates', 'partners', 'studio', 'shop', 'store', 'market', 'markets',
  'bakery', 'café', 'cafe', 'coffee', 'tea', 'foods?', 'catering', 'restaurant', 'bar', 'grill', 'pizza', 'pizzeria', 'bistro', 'diner', 'deli',
  'hotel', 'motel', 'inn', 'lodge', 'realty', 'real', 'estate', 'properties', 'property', 'homes?', 'builders?', 'building', 'developments?',
  'holdings', 'ventures', 'international', 'global', 'insurance', 'financial', 'finance', 'bank', 'credit', 'mortgage', 'accounting',
  'bookkeeping', 'tax', 'payroll', 'staffing', 'recruiting', 'agency', 'design', 'designs', 'media', 'marketing', 'advertising', 'tech',
  'technologies', 'technology', 'systems', 'software', 'computers', 'electronics', 'networks', 'wireless', 'security', 'alarms', 'locksmith',
  'logistics', 'transport', 'transportation', 'trucking', 'freight', 'courier', 'delivery', 'movers', 'moving', 'storage', 'express',
  'farms?', 'ranch', 'nursery', 'greenhouse', 'garden', 'gardens', 'florist', 'flowers', 'supply', 'supplies', 'hardware', 'lumber',
  'rentals?', 'leasing', 'repair', 'repairs', 'maintenance', 'heating', 'cooling', 'hvac', 'mechanical', 'welding', 'machine', 'machining',
  'industries', 'industrial', 'manufacturing', 'distribution', 'wholesale', 'printing', 'print', 'signs', 'graphics', 'photography',
  'salon', 'spa', 'barber', 'nails', 'fitness', 'gym', 'yoga', 'dance', 'music', 'school', 'academy', 'learning', 'tutoring', 'daycare',
  'church', 'foundation', 'society', 'association', 'centre', 'center', 'flooring', 'floors', 'tile', 'stone', 'concrete', 'paving',
  'excavating', 'excavation', 'drilling', 'septic', 'disposal', 'recycling', 'scrap', 'metals?', 'steel', 'glass', 'windows', 'doors',
  'siding', 'gutters', 'eavestrough', 'insulation', 'drywall', 'masonry', 'carpentry', 'cabinets', 'cabinetry', 'millwork', 'upholstery',
  'interiors', 'renovations?', 'restoration', 'inspections?', 'surveying', 'engineering', 'architects', 'architecture', 'environmental',
  'energy', 'solar', 'propane', 'fuels?', 'water', 'pumps?', 'marine', 'boats', 'cycles?', 'sports', 'travel', 'tours', 'taxi', 'limo',
  'apparel', 'fashion', 'boutique', 'jewellery', 'jewelry', 'gifts', 'books', 'toys', 'pets', 'laundry', 'tailoring', 'alterations',
  'dispatch', 'communications', 'brewing', 'brewery', 'winery', 'vineyard', 'equipment', 'tool', 'tools', 'parts', 'products', 'trading',
  '&', 'and', 'et', 'of', 'the', 'de', 'du', 'des', 'les', 'la', 'le',
].join('|') + ')\\b', 'i');

/**
 * Whether a business name reads as a person's name alone: two or three capitalized words with
 * no business vocabulary, no digits and no punctuation a company name tends to carry. This never
 * decides anything by itself; it holds the business for a person to confirm, because a sole
 * proprietor genuinely trades under their own name.
 */
export function looksLikePersonalName(value: string): boolean {
  const text = plain(value);
  if (!text || text.length > 60) return false;
  if (/\d|[&@/()'"]/.test(text)) return false;
  if (BUSINESS_WORDS.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((word) => /^[A-ZÀ-Ý][a-zà-ÿ'-]+$/.test(word) || /^[A-ZÀ-Ý]\.$/.test(word));
}
