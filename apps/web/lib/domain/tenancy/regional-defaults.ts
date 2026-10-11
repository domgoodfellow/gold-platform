/**
 * Where a business is → what to suggest it runs on. One resolver for every door that founds or
 * edits a business, so the self-service form, Settings and any staff door cannot disagree about
 * what a province implies.
 *
 * A result is a proposal, never a binding: currency is a trading choice (a Canadian business may
 * invoice in USD) and a time zone is an operating setting the business may correct. Nothing here
 * calls a geocoder — the mapping is country and region only, and where that is not enough
 * (`requiresConfirmation`) the caller asks rather than guessing.
 */

export type RegionalSuggestion = {
  countryCode: string;
  regionCode?: string;
  timeZone?: string;
  currencyCode?: string;
  source: 'regional_mapping' | 'browser_fallback' | 'none';
  /** True when the country or region does not settle the answer — the person must look at it. */
  requiresConfirmation: boolean;
};

const COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');

export type Country = { code: string; name: string };

/** Names come from ICU at runtime for the reader's language; the code list is the ISO 3166-1 alpha-2 standard. */
export function listCountries(locale = 'en'): Country[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  return COUNTRY_CODES.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name, locale));
}

export function isCountryCode(value: string): boolean {
  return COUNTRY_CODES.includes(value);
}

export function countryName(code: string, locale = 'en'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export type Region = { code: string; name: string };

const CA_REGIONS: Record<string, [string, string, boolean?]> = {
  AB: ['Alberta', 'America/Edmonton'],
  BC: ['British Columbia', 'America/Vancouver'],
  MB: ['Manitoba', 'America/Winnipeg'],
  NB: ['New Brunswick', 'America/Moncton'],
  NL: ['Newfoundland and Labrador', 'America/St_Johns'],
  NS: ['Nova Scotia', 'America/Halifax'],
  NT: ['Northwest Territories', 'America/Yellowknife'],
  NU: ['Nunavut', 'America/Iqaluit', true],
  ON: ['Ontario', 'America/Toronto', true],
  PE: ['Prince Edward Island', 'America/Halifax'],
  QC: ['Quebec', 'America/Toronto'],
  SK: ['Saskatchewan', 'America/Regina'],
  YT: ['Yukon', 'America/Whitehorse'],
};

const AU_REGIONS: Record<string, [string, string, boolean?]> = {
  ACT: ['Australian Capital Territory', 'Australia/Sydney'],
  NSW: ['New South Wales', 'Australia/Sydney'],
  NT: ['Northern Territory', 'Australia/Darwin'],
  QLD: ['Queensland', 'Australia/Brisbane'],
  SA: ['South Australia', 'Australia/Adelaide'],
  TAS: ['Tasmania', 'Australia/Hobart'],
  VIC: ['Victoria', 'Australia/Melbourne'],
  WA: ['Western Australia', 'Australia/Perth'],
};

// The third element marks a state that spans more than one zone, so its answer is a proposal to confirm.
const US_REGIONS: Record<string, [string, string, boolean?]> = {
  AL: ['Alabama', 'America/Chicago'], AK: ['Alaska', 'America/Anchorage', true], AZ: ['Arizona', 'America/Phoenix'],
  AR: ['Arkansas', 'America/Chicago'], CA: ['California', 'America/Los_Angeles'], CO: ['Colorado', 'America/Denver'],
  CT: ['Connecticut', 'America/New_York'], DE: ['Delaware', 'America/New_York'], DC: ['District of Columbia', 'America/New_York'],
  FL: ['Florida', 'America/New_York', true], GA: ['Georgia', 'America/New_York'], HI: ['Hawaii', 'Pacific/Honolulu'],
  ID: ['Idaho', 'America/Boise', true], IL: ['Illinois', 'America/Chicago'], IN: ['Indiana', 'America/Indiana/Indianapolis', true],
  IA: ['Iowa', 'America/Chicago'], KS: ['Kansas', 'America/Chicago', true], KY: ['Kentucky', 'America/New_York', true],
  LA: ['Louisiana', 'America/Chicago'], ME: ['Maine', 'America/New_York'], MD: ['Maryland', 'America/New_York'],
  MA: ['Massachusetts', 'America/New_York'], MI: ['Michigan', 'America/Detroit', true], MN: ['Minnesota', 'America/Chicago'],
  MS: ['Mississippi', 'America/Chicago'], MO: ['Missouri', 'America/Chicago'], MT: ['Montana', 'America/Denver'],
  NE: ['Nebraska', 'America/Chicago', true], NV: ['Nevada', 'America/Los_Angeles'], NH: ['New Hampshire', 'America/New_York'],
  NJ: ['New Jersey', 'America/New_York'], NM: ['New Mexico', 'America/Denver'], NY: ['New York', 'America/New_York'],
  NC: ['North Carolina', 'America/New_York'], ND: ['North Dakota', 'America/Chicago', true], OH: ['Ohio', 'America/New_York'],
  OK: ['Oklahoma', 'America/Chicago'], OR: ['Oregon', 'America/Los_Angeles', true], PA: ['Pennsylvania', 'America/New_York'],
  RI: ['Rhode Island', 'America/New_York'], SC: ['South Carolina', 'America/New_York'], SD: ['South Dakota', 'America/Chicago', true],
  TN: ['Tennessee', 'America/Chicago', true], TX: ['Texas', 'America/Chicago', true], UT: ['Utah', 'America/Denver'],
  VT: ['Vermont', 'America/New_York'], VA: ['Virginia', 'America/New_York'], WA: ['Washington', 'America/Los_Angeles'],
  WV: ['West Virginia', 'America/New_York'], WI: ['Wisconsin', 'America/Chicago'], WY: ['Wyoming', 'America/Denver'],
};

const REGION_TABLES: Record<string, Record<string, [string, string, boolean?]>> = { CA: CA_REGIONS, US: US_REGIONS, AU: AU_REGIONS };

/** Countries whose provinces or states are a closed list worth a picker; elsewhere a region is free text. */
export function listRegions(countryCode: string): Region[] {
  const table = REGION_TABLES[countryCode];
  if (!table) return [];
  return Object.entries(table).map(([code, [name]]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** One zone settles the country. Where a country spans several and no region table exists, it is absent here on purpose. */
const SINGLE_ZONE: Record<string, string> = {
  AE: 'Asia/Dubai', AT: 'Europe/Vienna', BE: 'Europe/Brussels', CH: 'Europe/Zurich', CZ: 'Europe/Prague', DE: 'Europe/Berlin',
  DK: 'Europe/Copenhagen', ES: 'Europe/Madrid', FI: 'Europe/Helsinki', FR: 'Europe/Paris', GB: 'Europe/London', GR: 'Europe/Athens',
  HK: 'Asia/Hong_Kong', HU: 'Europe/Budapest', IE: 'Europe/Dublin', IL: 'Asia/Jerusalem', IN: 'Asia/Kolkata', IT: 'Europe/Rome',
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', LU: 'Europe/Luxembourg', NL: 'Europe/Amsterdam', NO: 'Europe/Oslo', NZ: 'Pacific/Auckland',
  PL: 'Europe/Warsaw', PT: 'Europe/Lisbon', SE: 'Europe/Stockholm', SG: 'Asia/Singapore', ZA: 'Africa/Johannesburg',
};

const EUROZONE = 'AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK'.split(' ');

/** What a country usually trades in. A suggestion only — see the module comment. */
const CURRENCY: Record<string, string> = {
  AE: 'AED', AU: 'AUD', BR: 'BRL', CA: 'CAD', CH: 'CHF', CZ: 'CZK', DK: 'DKK', GB: 'GBP', HK: 'HKD', HU: 'HUF', IL: 'ILS',
  IN: 'INR', JP: 'JPY', KR: 'KRW', MX: 'MXN', NO: 'NOK', NZ: 'NZD', PL: 'PLN', SE: 'SEK', SG: 'SGD', US: 'USD', ZA: 'ZAR',
};

export function suggestRegionalDefaults(input: { countryCode: string; regionCode?: string; browserTimeZone?: string }): RegionalSuggestion {
  const countryCode = input.countryCode.trim().toUpperCase();
  const regionCode = input.regionCode?.trim().toUpperCase() || undefined;
  const currencyCode = EUROZONE.includes(countryCode) ? 'EUR' : CURRENCY[countryCode];

  if (!isCountryCode(countryCode)) {
    return { countryCode, regionCode, source: 'none', requiresConfirmation: true };
  }

  const table = REGION_TABLES[countryCode];
  if (table) {
    const row = regionCode ? table[regionCode] : undefined;
    if (row) return { countryCode, regionCode, timeZone: row[1], currencyCode, source: 'regional_mapping', requiresConfirmation: row[2] === true };
    return { countryCode, regionCode, currencyCode, source: 'none', requiresConfirmation: true };
  }

  const single = SINGLE_ZONE[countryCode];
  if (single) return { countryCode, regionCode, timeZone: single, currencyCode, source: 'regional_mapping', requiresConfirmation: false };

  if (input.browserTimeZone) {
    return { countryCode, regionCode, timeZone: input.browserTimeZone, currencyCode, source: 'browser_fallback', requiresConfirmation: true };
  }
  return { countryCode, regionCode, currencyCode, source: 'none', requiresConfirmation: true };
}

/** "Eastern Time (Toronto)" rather than "America/Toronto". */
export function timeZoneLabel(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date());
    const name = parts.find((part) => part.type === 'timeZoneName')?.value;
    const city = timeZone.split('/').pop()?.replace(/_/g, ' ');
    return name && city ? `${name} (${city})` : timeZone.replace(/_/g, ' ');
  } catch {
    return timeZone.replace(/_/g, ' ');
  }
}

const POSTAL: Record<string, RegExp> = {
  CA: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d$/i,
  US: /^\d{5}(-\d{4})?$/,
  GB: /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i,
  AU: /^\d{4}$/,
  DE: /^\d{5}$/,
  FR: /^\d{5}$/,
  NL: /^\d{4}\s?[A-Z]{2}$/i,
};

/** A format check only where the country's format is known and stable; elsewhere any short value is accepted. */
export function postalCodeValid(countryCode: string, value: string): boolean {
  const code = value.trim();
  if (code.length === 0 || code.length > 20) return false;
  const pattern = POSTAL[countryCode.toUpperCase()];
  return pattern ? pattern.test(code) : true;
}
