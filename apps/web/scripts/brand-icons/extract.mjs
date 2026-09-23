// One-off generator, not part of the build: reads the exact icons this platform uses out of the
// locally-installed @iconify-json/logos data file and writes them as static, inline SVG markup
// into a checked-in TypeScript module. Nothing at runtime imports the iconify package or fetches
// anything — this script runs once (and again whenever the curated list below changes), and only
// its output ships.
//
// Run: node scripts/brand-icons/extract.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(here, '..', '..', 'node_modules', '@iconify-json', 'logos', 'icons.json');
const outPath = path.join(here, '..', '..', 'features', 'platform', 'brand', 'marks.generated.ts');

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const defaultWidth = data.width ?? 24;
const defaultHeight = data.height ?? 24;

// Our key -> the collection's key. Every entry here was confirmed present in the installed
// @iconify-json/logos@1.2.14 data before being added — never guessed.
const WANTED = {
  // Providers (infrastructure GOLD operates)
  openai: 'openai-icon',
  anthropic: 'anthropic-icon',
  google: 'google-icon',
  twilio: 'twilio-icon',
  resend: 'resend-icon',
  deepgram: 'deepgram-icon',
  elevenlabs: 'elevenlabs-icon',

  // Connectors (outside apps a tenant authorizes)
  google_workspace: 'google-workspace',
  google_ads: 'google-ads',
  google_analytics: 'google-analytics',
  google_search_console: 'google-search-console',
  youtube: 'youtube-icon',
  microsoft_365: 'microsoft-icon',
  notion: 'notion-icon',
  slack: 'slack-icon',
  dropbox: 'dropbox',
  hubspot: 'hubspot',
  salesforce: 'salesforce',
  shopify: 'shopify',

  // Connector apps (Google Workspace / Microsoft 365 child apps)
  gmail: 'google-gmail',
  drive: 'google-drive',
  calendar: 'google-calendar',
  meet: 'google-meet',
  keep: 'google-keep',
  teams: 'microsoft-teams',
};

const marks = {};
const missing = [];
for (const [ourKey, iconKey] of Object.entries(WANTED)) {
  const icon = data.icons[iconKey];
  if (!icon) {
    missing.push(`${ourKey} -> ${iconKey}`);
    continue;
  }
  marks[ourKey] = {
    viewBox: `0 0 ${icon.width ?? defaultWidth} ${icon.height ?? defaultHeight}`,
    body: icon.body,
  };
}

if (missing.length > 0) {
  console.error('Missing from the installed collection (fix WANTED or re-check coverage):');
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

const header = `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/brand-icons/extract.mjs
//
// Source: @iconify-json/logos (CC0-1.0 for the compiled data; each mark remains its vendor's own
// trademark, used here to identify that vendor's product, not to claim endorsement by it). No
// runtime dependency on iconify — this is inline SVG markup, checked in.

export type GeneratedMark = { viewBox: string; body: string };

export const GENERATED_MARKS: Record<string, GeneratedMark> = ${JSON.stringify(marks, null, 2)};
`;

writeFileSync(outPath, header);
console.log(`Wrote ${Object.keys(marks).length} marks to ${path.relative(process.cwd(), outPath)}`);
