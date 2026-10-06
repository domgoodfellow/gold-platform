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

// Providers and Connectors — one identity per key, never shared with another entity. Every value
// here was confirmed present in the installed @iconify-json/logos@1.2.14 or simple-icons@16.32.0
// data before being added — never guessed. Multicolour marks (logos) already carry their own
// `fill` per path; single-colour marks (simple-icons) get `hex` baked in at generation time below.
const TOP_LEVEL_FROM_LOGOS = {
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
  github: 'github-icon',
};

const TOP_LEVEL_FROM_SIMPLE_ICONS = {
  quickbooks: 'siQuickbooks',
};

// `google_business_profile` is NOT here on purpose: neither @iconify-json/logos nor simple-icons
// carries a Google Business Profile mark (checked directly against both installed packages'
// contents, not assumed), and this script refuses to guess a trademarked shape from memory. It
// keeps its curated colour + monogram fallback in `connector-icon.tsx` — an honest degrade, not a
// silent one.

// Connector apps — **keyed by `${connectorKey}:${appKey}`, never by `appKey` alone.** Two
// different suites seed the same app key for two different real apps (`google_workspace:calendar`
// is Google Calendar; `microsoft_365:calendar` is a different product entirely), so a flat
// `appKey`-only map would hand one suite's identity to the other's app by accident — which is
// exactly the bug this shape exists to make impossible rather than merely unlikely.
const APPS_FROM_LOGOS = {
  'google_workspace:gmail': 'google-gmail',
  'google_workspace:drive': 'google-drive',
  'google_workspace:calendar': 'google-calendar',
  'google_workspace:meet': 'google-meet',
  'google_workspace:keep': 'google-keep',
  'google_workspace:slides': 'slides',
  'microsoft_365:teams': 'microsoft-teams',
  'microsoft_365:onedrive': 'microsoft-onedrive',
};

const APPS_FROM_SIMPLE_ICONS = {
  'google_workspace:docs': 'siGoogledocs',
  'google_workspace:sheets': 'siGooglesheets',
  'google_workspace:forms': 'siGoogleforms',
  'google_workspace:chat': 'siGooglechat',
  'google_workspace:tasks': 'siGoogletasks',
};

// Microsoft 365's `outlook` and `excel` apps have no entry here on purpose — neither source
// package carries them (checked directly, not assumed). They fall back to the microsoft_365
// parent mark at render time (`connector-app-icons.tsx`'s fallback order), which names a real fact
// (this app belongs to that suite) rather than guessing at the app's own logo.

const simpleIcons = await import('simple-icons');
const missing = [];

function fromLogos(map) {
  const out = {};
  for (const [ourKey, iconKey] of Object.entries(map)) {
    const icon = logos.icons[iconKey];
    if (!icon) {
      missing.push(`@iconify-json/logos: ${ourKey} -> ${iconKey}`);
      continue;
    }
    out[ourKey] = { viewBox: `0 0 ${icon.width ?? defaultWidth} ${icon.height ?? defaultHeight}`, body: icon.body };
  }
  return out;
}

function fromSimpleIcons(map) {
  const out = {};
  for (const [ourKey, slug] of Object.entries(map)) {
    const icon = simpleIcons[slug];
    if (!icon) {
      missing.push(`simple-icons: ${ourKey} -> ${slug}`);
      continue;
    }
    out[ourKey] = { viewBox: '0 0 24 24', body: `<path fill="#${icon.hex}" d="${icon.path}"/>` };
  }
  return out;
}

const marks = { ...fromLogos(TOP_LEVEL_FROM_LOGOS), ...fromSimpleIcons(TOP_LEVEL_FROM_SIMPLE_ICONS) };
const appMarks = { ...fromLogos(APPS_FROM_LOGOS), ...fromSimpleIcons(APPS_FROM_SIMPLE_ICONS) };

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
// Known gaps, deliberate rather than silent: google_business_profile (no entry in either package)
// keeps its curated colour + monogram fallback; microsoft_365's outlook and excel apps (same
// reason) fall back to the microsoft_365 parent mark. Neither is guessed.

export type GeneratedMark = { viewBox: string; body: string };

/** Providers and Connectors — one identity per key. */
export const GENERATED_MARKS: Record<string, GeneratedMark> = ${JSON.stringify(marks, null, 2)};

/**
 * Connector apps, keyed by \`\${connectorKey}:\${appKey}\` — never by \`appKey\` alone, because two
 * suites seed the same app key for two different real apps (both seed a \`calendar\` app, and they
 * are not the same product).
 */
export const GENERATED_APP_MARKS: Record<string, GeneratedMark> = ${JSON.stringify(appMarks, null, 2)};
`;

writeFileSync(outPath, header);
console.log(
  `Wrote ${Object.keys(marks).length} top-level marks and ${Object.keys(appMarks).length} app marks to ${path.relative(process.cwd(), outPath)}`,
);
