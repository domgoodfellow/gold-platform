#!/usr/bin/env node
// UI copy check for operator surfaces (AGENTS.md → UI rules; docs/ui-system.md → Core rules).
//
// Flags, in operator-surface source under apps/ and packages/:
//   eyebrow           an uppercase, letter-spaced element (or GroupHeading) immediately before a heading
//   card-description  any CardDescription
//   subtitle          a muted sentence immediately after a heading, or first inside a titled OperationalPanel
//   nav-description   a NavigationList item whose description is a written sentence
//   info-icon         an info or help icon drawn inside a list's .map(), i.e. one per row
//   word              a banned word (docs/ui-system.md → Words we use) in text a person reads
//
// Public surfaces follow docs/public-web.md and are excluded by path from the layout rules above.
// Cases the rules keep are excluded by structure, not by comment: status and alert messages,
// permission blockers, short factual metadata, empty-state text, and error and not-found pages.
//
// The word rule reads every product surface, public ones included, plus lib/ and the error,
// not-found and loading pages. It parses each file with TypeScript and reads JSX text (fragments
// too), the literal parts of strings with {…}, visible props (title, label, placeholder,
// aria-label, tooltip, content, description and the like), messages passed to error constructors
// and toasts, and any other string that reads as prose. Keys, codes, class names and query text
// are not read. Deferred areas are listed in WORD_EXEMPT with a reason.
//
// A justified exception carries `ui-copy-allow: <reason>` on the line above it; keep those rare.
//
// Usage:
//   node scripts/check-ui-copy.mjs            report findings, grouped by workspace (exit 0)
//   node scripts/check-ui-copy.mjs --strict   exit 1 when anything is found
//   node scripts/check-ui-copy.mjs --json     findings as JSON
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// TypeScript is a dependency of the web app, not of the repository root.
const ts = createRequire(new URL('../apps/web/package.json', import.meta.url))('typescript');

export const SCOPES = ['apps/web/app', 'apps/web/features', 'apps/web/components', 'packages/ui/src'];
export const WORD_SCOPES = [...SCOPES, 'apps/web/lib'];

// Banned words (docs/ui-system.md → Words we use), whole words, any case.
export const BANNED_WORDS = [
  'configuration', 'configurations', 'configured', 'configure', 'configuring', 'configurable', 'reconfigure',
  'deployment', 'deployments', 'installation', 'installations',
  'provider', 'providers', 'capability', 'capabilities',
  'module', 'modules', 'entitlement', 'entitlements', 'entitled',
  'preset', 'presets', 'tenant', 'tenants',
  'canonical', 'runtime', 'runtimes', 'schema', 'schemas', 'diagnostic', 'diagnostics',
  'prerequisite', 'prerequisites', 'advisory', 'metadata', 'artifact', 'artifacts', 'payload', 'payloads', 'slice', 'slices',
  'constraint', 'constraints',
];
const BANNED = new RegExp(`\\b(${BANNED_WORDS.join('|')})\\b`, 'i');
// Phrases: "status" or "state" for work is a stage; maths ranges; GOLD is the old name (case-sensitive).
const BANNED_PHRASES = [/\bwork (item )?(status|statuses|state)\b/i, /\b(end|start) (exclusive|inclusive)\b/i, /\bGOLD\b/];

// Deferred areas the word rule does not read yet (Work Order 4). Nothing else is exempt.
export const WORD_EXEMPT = [
  // AI and Agent workspace: audit rows 73–77, deferred to the AI wording work order.
  [/^apps\/web\/features\/ai\/workbench\.tsx$/, 'AI workspace, deferred (audit rows 73–75)'],
  [/^apps\/web\/features\/ai\/workspace\.tsx$/, 'AI workspace, deferred (audit rows 73, 75)'],
  [/^apps\/web\/lib\/domain\/ai\/agents\.ts$/, 'Agent domain messages, deferred (audit row 76)'],
  [/^apps\/web\/features\/agent\/agent-shared\.tsx$/, 'Agent panel, deferred (audit row 77)'],
  [/^apps\/web\/lib\/domain\/assistant\/questions\.ts$/, 'Agent questions, deferred (audit row 77)'],
  // Platform-only screens, audit rows 92–100: seen by GildOps platform staff only, deferred.
  [/^apps\/web\/features\/platform\/catalog\/family-forms\.tsx$/, 'Platform catalogue, deferred (audit rows 92–93)'],
  [/^apps\/web\/app\/platform\/catalog\/(page|modules\/page|products\/page)\.tsx$/, 'Platform catalogue, deferred (audit row 93)'],
  [/^apps\/web\/app\/platform\/billing\/page\.tsx$/, 'Platform billing, deferred (audit row 94)'],
  [/^apps\/web\/app\/platform\/ai-runtime\/page\.tsx$/, 'Platform AI runtime, deferred (audit row 95)'],
  [/^apps\/web\/features\/platform\/ai-runtime\/runtime-assignment-(form|row)\.tsx$/, 'Platform AI runtime, deferred (audit row 95)'],
  [/^apps\/web\/app\/platform\/integrations\/page\.tsx$/, 'Platform integrations, deferred (audit row 96)'],
  [/^apps\/web\/app\/platform\/pricing\/page\.tsx$/, 'Platform pricing, deferred (audit row 97)'],
  [/^apps\/web\/features\/platform\/plans\/plan-forms\.tsx$/, 'Platform plans, deferred (audit row 97)'],
  [/^apps\/web\/features\/platform\/commercial\/(package-simulator|usage-event-drawer)\.tsx$/, 'Platform commercial, deferred (audit rows 97–98)'],
  [/^apps\/web\/app\/platform\/(usage|vendor-rates)\/page\.tsx$/, 'Platform usage and rates, deferred (audit row 98)'],
  [/^apps\/web\/features\/platform\/organizations\/organization-commercial-screen\.tsx$/, 'Platform commercial, deferred (audit row 98)'],
  [/^apps\/web\/lib\/domain\/providers\/(status|twilio-provisioning)\.ts$/, 'Platform providers, deferred (audit row 99)'],
  [/^apps\/web\/features\/platform\/providers\/twilio-provider-screen\.tsx$/, 'Platform providers, deferred (audit row 99)'],
  [/^apps\/web\/lib\/domain\/platform-billing\/reconciliation\.ts$/, 'Platform billing reconciliation, deferred (audit row 100)'],
];

// Not product text at all: tests, generated types, development-only pages.
const WORD_EXCLUDED_PATHS = [
  /\/node_modules\//, /\/tests?\//, /\/e2e\//, /\.(test|spec)\.tsx?$/, /\.d\.ts$/,
  /^apps\/web\/lib\/db\/(database\.)?types\.ts$/, /^apps\/web\/lib\/testing\//,
  /^apps\/web\/app\/dev\//, /^apps\/web\/features\/appearance\/design-gallery\.tsx$/,
  /^apps\/web\/lib\/catalogue-surface-coverage\.ts$/, // an internal build-coverage register read only by tests
];

export const wordExempt = (rel) => WORD_EXEMPT.find(([re]) => re.test(rel))?.[1] ?? null;

// Not operator surfaces, or not product UI at all.
export const EXCLUDED_PATHS = [
  /\/node_modules\//, /\/tests?\//, /\/e2e\//, /\.(test|spec)\.tsx$/,
  /^apps\/web\/app\/\(marketing\)\//, // GildOps marketing site
  /^apps\/web\/components\/marketing\//,
  /^apps\/web\/app\/\(public\)\//, // public customer pages: booking, portal, proposal, forms
  /^apps\/web\/app\/\(auth\)\//, // sign-in
  /^apps\/web\/features\/public-site\//, // tenant website renderers
  /^apps\/web\/features\/forms\//, // public form renderer
  /^apps\/web\/features\/portal-access\//, // customer portal
  /^apps\/web\/features\/studio\/portal\/portal-renderer\.tsx$/, // customer portal renderer, also drawn in Studio previews
  /^apps\/web\/features\/branding\/brand-preview\.tsx$/, // sample public pages drawn in a brand preview
  /^apps\/web\/features\/communications\/public-widget\.tsx$/, // website chat widget
  /^apps\/web\/app\/dev\//, /^apps\/web\/features\/appearance\/design-gallery\.tsx$/, // development-only gallery
  /(^|\/)(not-found|error|global-error|loading)\.tsx$/, // state pages and error boundaries
];

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'CardTitle', 'SectionHeading', 'PageHeading', 'SectionHeader', 'GroupHeading', 'DialogTitle', 'SheetTitle', 'DrawerTitle', 'AlertTitle', 'PageHeader', 'CollectionHeader', 'RecordHeader', 'WorkspaceHome', 'OperationalPanel', 'Card', 'ItemTitle']);
const SUBTITLE_AFTER = new Set(['h1', 'h2', 'h3', 'CardTitle', 'SectionHeading', 'PageHeading', 'SectionHeader', 'PageHeader', 'CollectionHeader', 'RecordHeader', 'ItemTitle']);
const MUTED = /text-muted|text-subtle|muted-foreground/;
const PROSE_TAGS = /^(p|div|span|Hint)$/;
const INFO_ICONS = /<(Info|InfoIcon|InfoPopover|CircleHelp|HelpCircle|CircleQuestionMark)\b/g;

export function isExcluded(rel) {
  return EXCLUDED_PATHS.some((re) => re.test(rel));
}

// Opening tag at i: { name, end, self, attrs } or null.
function openTag(src, i) {
  const m = /^<([A-Za-z][\w.]*)/.exec(src.slice(i, i + 80));
  if (!m) return null;
  let depth = 0, quote = null;
  const limit = Math.min(src.length, i + 3000);
  for (let j = i + m[0].length; j < limit; j++) {
    const c = src[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}') { if (--depth < 0) return null; }
    else if (depth === 0 && c === '<') return null;
    else if (depth === 0 && c === '>') return { name: m[1], end: j + 1, self: src[j - 1] === '/', attrs: src.slice(i + m[0].length, j) };
  }
  return null;
}

// End offset of the element whose opening tag is `tag` at `start`, or -1.
function elementEnd(src, tag) {
  if (tag.self) return tag.end;
  const re = new RegExp(`<\\/?${tag.name.replace(/\./g, '\\.')}(?![\\w.])`, 'g');
  re.lastIndex = tag.end;
  let depth = 1, m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith('</')) {
      if (--depth === 0) return src.indexOf('>', m.index) + 1;
    } else {
      const inner = openTag(src, m.index);
      if (inner) { if (!inner.self) depth++; re.lastIndex = inner.end; }
    }
  }
  return -1;
}

// The element that immediately follows `from`, allowing only whitespace, JSX comments and
// conditional expression glue (`{cond ? (`, `{x && `) between them. Text in between means no.
function nextSibling(src, from) {
  let depth = 0;
  const limit = Math.min(src.length, from + 200);
  for (let i = from; i < limit; i++) {
    const c = src[i];
    if (/\s/.test(c)) continue;
    if (src.startsWith('{/*', i)) { const e = src.indexOf('*/}', i); if (e < 0) return null; i = e + 2; continue; }
    if (c === '<') {
      if (src[i + 1] === '/') return null;
      const tag = openTag(src, i);
      return tag ? { at: i, tag } : null;
    }
    if (c === '{' || c === '(') { depth++; continue; }
    if (c === '}' || c === ')') { if (--depth <= 0) return null; continue; } // an expression child sits between
    if (depth > 0 && /[\w.$?:&|!=\[\]'"]/.test(c)) continue;
    return null;
  }
  return null;
}

// Strip `{...}` expressions (balanced) and tags, leaving the literal words a person reads.
function literalText(raw) {
  let out = '', depth = 0;
  for (const c of raw) {
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += c;
  }
  return out.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, "'").replace(/\s+/g, ' ').trim();
}

// Supporting text the rules keep, recognized by structure.
function keptByStructure(attrs, raw) {
  if (/\brole=["'{](status|alert)/.test(attrs)) return 'status message';
  if (/\bYour role\b|\blacks? [\w.]+ permission\b|\b(do not|don't) have permission\b|\bnot allowed to\b/i.test(raw)) return 'permission blocker';
  const literal = literalText(raw);
  if (/^(No|Nothing|None)\b/.test(literal)) return 'empty-state text';
  const words = literal.split(' ').filter((w) => /[A-Za-z]{2,}/.test(w));
  // A value drawn from data that is itself a description is still a subtitle.
  if (words.length === 0 && /\b\w*(description|summary|intro|purpose|explanation|DESCRIPTIONS)\w*\b|\{\s*text\s*\}/.test(raw)) return null;
  if (words.length < 5) return 'factual metadata';
  // Short facts separated by middle dots ("open · anonymous visitor · no Customer created").
  const facts = literal.split('·');
  if (facts.length > 1 && facts.every((fact) => fact.trim().split(/\s+/).filter(Boolean).length <= 3)) return 'factual metadata';
  return null;
}

const EMPTY_REGION = /(data-slot|id|aria-labelledby)=["'{`][^"'}`]*empty/i;

// Whether more content follows `from` in the same region: closing wrapper divs and the end of a
// conditional are skipped; another element means content follows; anything else ends the region.
function contentFollows(src, from) {
  const limit = Math.min(src.length, from + 400);
  for (let i = from; i < limit; i++) {
    if (/\s/.test(src[i])) continue;
    if (src.startsWith('</div>', i)) { i += 5; continue; }
    if (src.startsWith('{/*', i)) { const e = src.indexOf('*/}', i); if (e < 0) return false; i = e + 2; continue; }
    if (src[i] === '{') return true; // a conditional or mapped child
    if (/[)}:]/.test(src[i])) continue;
    if (src.startsWith('null', i)) { i += 3; continue; }
    if (src[i] === '<') return /[A-Za-z{]/.test(src[i + 1] ?? '');
    return false;
  }
  return false;
}

function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return starts;
}

export function scanSource(src, rel) {
  const starts = lineStarts(src);
  const lines = src.split('\n');
  const lineOf = (i) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= i) lo = mid; else hi = mid - 1; } return lo + 1; };
  const allowed = (line) => /ui-copy-allow:\s*\S/.test(lines[line - 2] ?? '');
  const findings = [];
  const push = (rule, at, detail) => { const line = lineOf(at); if (!allowed(line)) findings.push({ rule, file: rel, line, detail }); };

  const tagRe = /<([A-Za-z][\w.]*)/g;
  let m;
  while ((m = tagRe.exec(src))) {
    if (m.index > 0 && /[\w)\]]/.test(src[m.index - 1])) continue; // generic or comparison, not JSX
    const tag = openTag(src, m.index);
    if (!tag) continue;
    const eyebrowStyled = (/\buppercase\b/.test(tag.attrs) && /\btracking-/.test(tag.attrs)) || tag.name === 'GroupHeading';
    if (tag.name === 'CardDescription') push('card-description', m.index, 'CardDescription');
    if (!eyebrowStyled && !SUBTITLE_AFTER.has(tag.name) && tag.name !== 'OperationalPanel') continue;

    if (eyebrowStyled) {
      const end = elementEnd(src, tag);
      const sib = end > 0 ? nextSibling(src, end) : null;
      if (sib && HEADINGS.has(sib.tag.name)) push('eyebrow', m.index, `<${tag.name}> before <${sib.tag.name}>`);
    }
    const subtitleAt = (sib, where, headingRaw = '', soleIsState = true) => {
      if (!sib || !PROSE_TAGS.test(sib.tag.name)) return;
      if (sib.tag.name !== 'Hint' && !MUTED.test(sib.tag.attrs)) return;
      const end = elementEnd(src, sib.tag);
      const raw = end > 0 ? src.slice(sib.tag.end, end) : '';
      if (keptByStructure(sib.tag.attrs, raw)) return;
      // An empty state may say what the section is for: a heading that states the emptiness, or
      // a region marked as an empty state.
      if (/^(No|Nothing)\b/.test(literalText(headingRaw)) || EMPTY_REGION.test(src.slice(Math.max(0, m.index - 400), m.index))) return;
      // A sentence with nothing after it is the section's state, not a subtitle above content.
      if (soleIsState && end > 0 && !contentFollows(src, end)) return;
      push('subtitle', sib.at, `<${sib.tag.name}> muted ${where}`);
    };
    if (SUBTITLE_AFTER.has(tag.name)) {
      const end = elementEnd(src, tag);
      if (end > 0) {
        const headingRaw = tag.self ? '' : src.slice(tag.end, end);
        const direct = nextSibling(src, end);
        if (direct && PROSE_TAGS.test(direct.tag.name)) subtitleAt(direct, `after <${tag.name}>`, headingRaw);
        else {
          // A heading row: the heading and its actions share a wrapper; a sentence right after the
          // wrapper is still the heading's subtitle.
          let pos = end, sib = direct;
          for (let n = 0; sib && n < 4; n++) { const e = elementEnd(src, sib.tag); if (e < 0) { pos = -1; break; } pos = e; sib = nextSibling(src, pos); }
          const close = pos > 0 && !sib ? /^\s*<\/div>/.exec(src.slice(pos, pos + 40)) : null;
          if (close) subtitleAt(nextSibling(src, pos + close[0].length), `after <${tag.name}> row`, headingRaw);
        }
      }
    }
    if (tag.name === 'OperationalPanel' && !tag.self) subtitleAt(nextSibling(src, tag.end), 'first in <OperationalPanel>', '', false);
  }

  if (/<NavigationList\b/.test(src)) {
    for (const d of src.matchAll(/\bdescription\s*:\s*(['"`])([^'"`]*)\1/g)) {
      if (d[2].split(/\s+/).filter(Boolean).length >= 5) push('nav-description', d.index, d[2].slice(0, 80));
    }
  }

  for (const icon of src.matchAll(INFO_ICONS)) {
    const before = src.slice(Math.max(0, icon.index - 1500), icon.index);
    const map = before.lastIndexOf('.map(');
    if (map < 0) continue;
    let depth = 0;
    for (const c of before.slice(map + 4)) { if (c === '(') depth++; else if (c === ')') depth--; }
    if (depth > 0) push('info-icon', icon.index, `<${icon[1]}> inside .map()`);
  }
  return findings;
}

// ---- word rule ---------------------------------------------------------------------------------

// JSX props a person reads.
const VISIBLE_PROP = /^(title|label|placeholder|aria-label|aria-description|aria-valuetext|alt|tooltip|content|description|hint|helper|helperText|message|heading|subtitle|summary|caption|emptyMessage|empty|confirm|cta|[a-z][A-Za-z]*(Label|Title|Text|Message|Description|Hint|Placeholder|Heading|Tooltip|Caption|Summary))$/;
// Object keys whose string is shown, or sent to a person (server action results, emails).
const VISIBLE_KEY = /^(title|label|placeholder|tooltip|content|description|definition|hint|helper|message|heading|subtitle|summary|caption|error|reason|detail|note|blocker|subject|text|html|body|preheader|intro|outro|cta|empty|state|status|value|[a-z][A-Za-z]*(Label|Title|Text|Message|Description|Hint|Placeholder|Heading|Tooltip|Caption|Summary|Reason|Detail|Error))$/;
// Object keys that hold codes, routes, classes or query text.
const CODE_KEY = /^(id|key|keys|kind|type|code|codes|segment|path|href|route|url|src|icon|variant|tone|className|class|select|table|column|columns|order|rpc|channel|digest|sql|query|pattern|method|accept|testId|dataKey)$/;
// Calls whose string arguments are never read by a person.
const CODE_CALL = /^(cn|clsx|cva|twMerge|from|rpc|select|eq|neq|in|is|not|order|match|filter|or|like|ilike|contains|containedBy|gt|gte|lt|lte|range|limit|single|maybeSingle|channel|on|upload|remove|download|createSignedUrl|getPublicUrl|get|set|has|delete|getAll|append|startsWith|endsWith|includes|indexOf|replace|replaceAll|split|join|test|exec|padStart|padEnd|localeCompare|redirect|permanentRedirect|revalidatePath|revalidateTag|notFound|encodeURIComponent|decodeURIComponent|fetch|require|import|RegExp|Symbol|describe|it|test|expect|addEventListener|removeEventListener|querySelector|querySelectorAll|getElementById|setAttribute|getAttribute|createElement|log|warn|info|debug|error|trace|parse|stringify|DateTimeFormat|NumberFormat|toLocaleString|toLocaleDateString|toLocaleTimeString|useSearchParams|header|cookies|headers|requireEnv|env|assertNever|invariant|areaHref|workspaceHref|href|route|path|pathFor|z|enum|literal|object|string|matchMedia|track|emit|dispatchEvent|CustomEvent|Event|postMessage|digest|createHash|update|randomUUID|sql)$/;

const isKeyLike = (text) => !/\s/.test(text.trim()) && (/^[a-z0-9_$#@./:=\-]/.test(text.trim()) || /[._/:=#@]/.test(text) || /^[A-Z0-9_]+$/.test(text.trim()));
// Class lists ("flex items-center gap-2"), query text ("id, name") and code are not prose.
const looksLikeCode = (t) => {
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.every((x) => /^[a-z0-9:\-[\]/.%!#()&>~*+_]+$/.test(x)) && tokens.some((x) => /[-:[]/.test(x))) return true;
  return /=>|\(\)|\s===?\s|<\/?[a-z]|^\s*(select|insert|update|delete|with)\s/i.test(t);
};
const isProse = (text) => {
  const t = text.trim();
  if (!/\s/.test(t)) return /^[A-Z][a-z]+$/.test(t); // a single capitalised word is a label
  if (looksLikeCode(t)) return false;
  return /^[A-Z]/.test(t) || /[.?!]$/.test(t) || /[A-Za-z]{2,} [A-Za-z]{2,}/.test(t);
};

function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  if (ts.isCallExpression(expr)) return calleeName(expr.expression);
  return '';
}

function stringText(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => `{}${s.literal.text}`).join('');
  if (ts.isJsxText(node)) return node.text;
  return null;
}

// Whether a person reads this string: 'visible', 'prose' (read if it reads as prose) or null.
function readership(node) {
  if (ts.isJsxText(node)) return 'visible';
  let child = node, parent = node.parent;
  // Climb through expression glue (and out of `${…}`) to the place the value is used.
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isConditionalExpression(parent) && parent.condition !== child
    || ts.isBinaryExpression(parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.PlusToken].includes(parent.operatorToken.kind)
    || ts.isAsExpression(parent) || ts.isSatisfiesExpression?.(parent) || ts.isTemplateSpan(parent) || ts.isArrayLiteralExpression(parent))) {
    if (ts.isTemplateSpan(parent)) { child = parent.parent; parent = child.parent; continue; }
    child = parent; parent = parent.parent;
  }
  if (!parent) return 'prose';
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isLiteralTypeNode(parent) || ts.isImportTypeNode?.(parent)) return null;
  if (ts.isCaseClause(parent) || ts.isElementAccessExpression(parent)) return null;
  if (ts.isPropertyAccessExpression(parent)) return 'prose'; // [...].map(...), 'text'.trim()
  if (ts.isBinaryExpression(parent)) return null; // comparisons, `in`, assignments to keys
  if (ts.isPropertyAssignment(parent)) {
    if (parent.name === child) return null;
    const key = parent.name.getText().replace(/^['"]|['"]$/g, '');
    if (VISIBLE_KEY.test(key)) return 'visible';
    if (CODE_KEY.test(key)) return null;
    return 'prose';
  }
  if (ts.isJsxExpression(parent)) {
    const holder = parent.parent;
    if (ts.isJsxAttribute(holder)) return VISIBLE_PROP.test(holder.name.getText()) ? 'visible' : null;
    return 'visible'; // a child expression
  }
  if (ts.isJsxAttribute(parent)) return VISIBLE_PROP.test(parent.name.getText()) ? 'visible' : null;
  if (ts.isNewExpression(parent)) {
    const name = calleeName(parent.expression);
    if (/Error$/.test(name) && parent.arguments?.[0] === child) return 'visible';
    return /^(URL|RegExp|Date|Map|Set|Intl)/.test(name) ? null : 'prose';
  }
  if (ts.isCallExpression(parent)) {
    if (parent.expression === child) return null;
    const name = calleeName(parent.expression);
    const target = ts.isPropertyAccessExpression(parent.expression) ? parent.expression.expression.getText() : '';
    if (name === 'toast' || target === 'toast') return 'visible';
    if (target === 'console' || target === 'process.env' || target === 'JSON' || target === 'Object' || target === 'z') return null;
    // The first argument of these calls is a key, a column or a class; later ones may be text
    // (`outstanding.set('drafting', 'This deployment cannot…')`).
    if (CODE_CALL.test(name) && parent.arguments[0] === child) return null;
    return 'prose';
  }
  if (ts.isEnumMember(parent) || ts.isComputedPropertyName(parent) || ts.isTypeReferenceNode(parent) || ts.isIndexedAccessTypeNode(parent)) return null;
  if (ts.isTaggedTemplateExpression(parent)) return null;
  return 'prose';
}

export function scanWords(src, rel) {
  if (wordExempt(rel)) return [];
  const file = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = src.split('\n');
  const findings = [];
  const visit = (node) => {
    const text = stringText(node);
    if (text !== null && /[A-Za-z]/.test(text)) {
      const reader = readership(node);
      const read = reader === 'visible' ? !isKeyLike(text) : reader === 'prose' ? isProse(text) : false;
      if (read) {
        const hit = BANNED.exec(text)?.[1] ?? BANNED_PHRASES.map((re) => re.exec(text)?.[0]).find(Boolean);
        if (hit) {
          const start = node.getStart(file);
          const offset = Math.max(0, text.indexOf(hit));
          const line = file.getLineAndCharacterOfPosition(ts.isJsxText(node) ? node.pos + node.getFullText(file).indexOf(hit) : start).line + 1;
          if (!/ui-copy-allow:\s*\S/.test(lines[line - 2] ?? '') && !/ui-copy-allow:\s*\S/.test(lines[file.getLineAndCharacterOfPosition(start).line - 1] ?? '')) {
            findings.push({ rule: 'word', file: rel, line, detail: `"${hit}" in "${text.replace(/\s+/g, ' ').trim().slice(Math.max(0, offset - 30), offset + 50)}"` });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

function walk(root, dir, out, { words = false } = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(root, p).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(name)) walk(root, p, out, { words }); }
    else if (words ? /\.tsx?$/.test(p) && !WORD_EXCLUDED_PATHS.some((re) => re.test(rel)) : p.endsWith('.tsx') && !isExcluded(rel)) out.push(rel);
  }
  return out;
}

export function scan(root) {
  const files = SCOPES.flatMap((scope) => walk(root, join(root, scope), []));
  const layout = files.flatMap((rel) => scanSource(readFileSync(join(root, rel), 'utf8'), rel));
  const wordFiles = WORD_SCOPES.flatMap((scope) => walk(root, join(root, scope), [], { words: true }));
  const words = wordFiles.flatMap((rel) => scanWords(readFileSync(join(root, rel), 'utf8'), rel));
  return [...layout, ...words];
}

const WORKSPACES = [
  ['platform', /app\/platform\/|features\/platform\/|features\/catalogue\//],
  ['crm', /\/crm\/|features\/crm\/|features\/customers\//],
  ['work', /\/(work|field|schedule|resources|locations|assets|dispatch)\/|features\/(work|scheduling|resources|locations|assets)\//],
  ['communications', /\/(comms|calls|communications)\/|features\/communications\//],
  ['finance', /\/finance\/|features\/(finance|pricing)\//],
  ['support', /\/support\/|features\/support\//],
  ['marketing', /\/marketing\/|features\/marketing\//],
  ['ai', /\/ai\/|features\/ai\//],
  ['studio', /\/studio\/|features\/studio\//],
  ['setup', /\/setup\/|features\/setup\//],
  ['home', /\/home\/|features\/home\//],
  ['library', /\/library\/|features\/library\//],
  ['insights', /\/(reports|reporting|insights)\/|features\/reporting\//],
  ['help', /\/help\//],
  ['automations', /\/automations\/|features\/automations\//],
  ['settings', /\/(settings|account|organizations\/accept-invite)\/|features\/(settings|tenancy|account|appearance|branding|domains|integrations|access)\//],
  ['shared', /components\/|packages\/ui\//],
];
export const workspaceOf = (file) => (WORKSPACES.find(([, re]) => re.test(file)) ?? ['other'])[0];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const findings = scan(root);
  if (process.argv.includes('--json')) console.log(JSON.stringify(findings, null, 1));
  else {
    const groups = new Map();
    for (const f of findings) { const w = workspaceOf(f.file); if (!groups.has(w)) groups.set(w, []); groups.get(w).push(f); }
    for (const [w, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`\n${w} (${list.length})`);
      for (const f of list) console.log(`  ${f.file}:${f.line}  ${f.rule}  ${f.detail}`);
    }
    console.log(`\n${findings.length} finding(s). Rules: AGENTS.md → UI rules; docs/ui-system.md → Core rules.`);
  }
  if (process.argv.includes('--strict') && findings.length) process.exitCode = 1;
}
