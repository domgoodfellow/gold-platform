// One-off generator, not part of the build: reads the exact icons this platform uses out of two
// locally-installed, CC0-licensed icon data packages and writes them as static, inline SVG markup
// into a checked-in TypeScript module. Nothing at runtime imports either package or fetches
// anything — this script runs once (and again whenever the curated lists below change), and only
// its output ships.
//
// Run: node scripts/brand-icons/extract.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const logosPath = path.join(here, '..', '..', 'node_modules', '@iconify-json', 'logos', 'icons.json');
const outPath = path.join(here, '..', '..', 'features', 'platform', 'brand', 'marks.generated.ts');

const logos = JSON.parse(readFileSync(logosPath, 'utf8'));
const defaultWidth = logos.width ?? 24;
const defaultHeight = logos.height ?? 24;

// Our key -> the collection's key. Every entry here was confirmed present in the installed
// @iconify-json/logos@1.2.14 data before being added — never guessed. Multicolour: each path in
// `body` already carries its own `fill`.
const FROM_LOGOS = {
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
  slides: 'slides',
  teams: 'microsoft-teams',
};

// Confirmed present in the installed simple-icons@16.32.0 data before being added. Single-colour:
// `hex` is baked into the generated path's own `fill` at generation time, so the shipped markup
// still needs no runtime colouring logic.
//
// Microsoft Outlook and Excel are NOT here on purpose (see the "known gaps" note below) — neither
// simple-icons nor @iconify-json/logos carries them, and this script refuses to guess a trademarked
// shape from memory. Both fall back to the microsoft_365 parent mark at render time
// (`connector-app-icons.tsx`), which is an honest degrade, not a silent one.
const FROM_SIMPLE_ICONS = {
  docs: 'siGoogledocs',
  sheets: 'siGooglesheets',
  forms: 'siGoogleforms',
  chat: 'siGooglechat',
  tasks: 'siGoogletasks',
};

const marks = {};
const missing = [];

for (const [ourKey, iconKey] of Object.entries(FROM_LOGOS)) {
  const icon = logos.icons[iconKey];
  if (!icon) {
    missing.push(`@iconify-json/logos: ${ourKey} -> ${iconKey}`);
    continue;
  }
  marks[ourKey] = {
    viewBox: `0 0 ${icon.width ?? defaultWidth} ${icon.height ?? defaultHeight}`,
    body: icon.body,
  };
}

const simpleIcons = await import('simple-icons');
for (const [ourKey, slug] of Object.entries(FROM_SIMPLE_ICONS)) {
  const icon = simpleIcons[slug];
  if (!icon) {
    missing.push(`simple-icons: ${ourKey} -> ${slug}`);
    continue;
  }
  marks[ourKey] = {
    viewBox: '0 0 24 24',
    body: `<path fill="#${icon.hex}" d="${icon.path}"/>`,
  };
}

if (missing.length > 0) {
  console.error('Missing from an installed collection (fix the WANTED lists or re-check coverage):');
  for (const m of missing) console.error(`  ${m}`);
  process.exit(1);
}

const header = `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/brand-icons/extract.mjs
//
// Sources: @iconify-json/logos and simple-icons, both CC0-1.0 for the compiled data; each mark
// remains its vendor's own trademark, used here to identify that vendor's product, not to claim
// endorsement by it. No runtime dependency on either package — this is inline SVG markup, checked
// in.
//
// Known gaps, deliberate rather than silent: Microsoft Outlook and Excel have no entry here
// because neither source package carries them; they render as the microsoft_365 parent mark
// instead (see connector-app-icons.tsx's fallback order).

export type GeneratedMark = { viewBox: string; body: string };

export const GENERATED_MARKS: Record<string, GeneratedMark> = ${JSON.stringify(marks, null, 2)};
`;

writeFileSync(outPath, header);
console.log(`Wrote ${Object.keys(marks).length} marks to ${path.relative(process.cwd(), outPath)}`);
