#!/usr/bin/env node
// UI copy check for operator surfaces (AGENTS.md → UI rules; docs/ui-system.md → Core rules).
//
// Flags, in operator-surface source under apps/ and packages/:
//   eyebrow           an uppercase, letter-spaced element (or GroupHeading) immediately before a heading
//   card-description  any CardDescription
//   subtitle          a muted sentence immediately after a heading, or first inside a titled OperationalPanel
//   nav-description   a NavigationList item whose description is a written sentence
//   info-icon         an info or help icon drawn inside a list's .map(), i.e. one per row
//
// Public surfaces follow docs/public-web.md and are excluded by path. Cases the rules keep are
// excluded by structure, not by comment: status and alert messages, permission blockers, short
// factual metadata, empty-state text, and error and not-found pages. A justified exception carries
// `ui-copy-allow: <reason>` on the line above it; keep those rare.
//
// Usage:
//   node scripts/check-ui-copy.mjs            report findings, grouped by workspace (exit 0)
//   node scripts/check-ui-copy.mjs --strict   exit 1 when anything is found
//   node scripts/check-ui-copy.mjs --json     findings as JSON
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCOPES = ['apps/web/app', 'apps/web/features', 'apps/web/components', 'packages/ui/src'];

// Not operator surfaces, or not product UI at all.
export const EXCLUDED_PATHS = [
  /\/node_modules\//, /\/tests?\//, /\/e2e\//, /\.(test|spec)\.tsx$/,
  /^apps\/web\/app\/\(marketing\)\//, // GildOps marketing site
  /^apps\/web\/components\/marketing\//,
  /^apps\/web\/app\/\(public\)\//, // public customer pages: booking, portal, proposal, forms
  /^apps\/web\/app\/\(auth\)\//, // sign-in
  /^apps\/web\/features\/public-site\//, // tenant website renderers
  /^apps\/web\/features\/forms\//, // public form renderer
  /^apps\/web\/features\/communications\/public-widget\.tsx$/, // website chat widget
  /^apps\/web\/app\/dev\//, /^apps\/web\/features\/appearance\/design-gallery\.tsx$/, // development-only gallery
  /(^|\/)(not-found|error|global-error|loading)\.tsx$/, // state pages and error boundaries
];

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'CardTitle', 'SectionHeading', 'PageHeading', 'SectionHeader', 'GroupHeading', 'DialogTitle', 'SheetTitle', 'DrawerTitle', 'AlertTitle', 'PageHeader', 'CollectionHeader', 'RecordHeader', 'WorkspaceHome', 'OperationalPanel', 'Card', 'ItemTitle']);
const SUBTITLE_AFTER = new Set(['h1', 'h2', 'h3', 'CardTitle', 'SectionHeading', 'PageHeading', 'SectionHeader', 'PageHeader', 'CollectionHeader', 'RecordHeader', 'ItemTitle']);
const MUTED = /text-muted|text-subtle|muted-foreground/;
const PROSE_TAGS = /^(p|div|span|Hint)$/;
const INFO_ICONS = /<(Info|InfoIcon|CircleHelp|HelpCircle|CircleQuestionMark)\b/g;

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
      if (end > 0) subtitleAt(nextSibling(src, end), `after <${tag.name}>`, tag.self ? '' : src.slice(tag.end, end));
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

function walk(root, dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(root, p).replace(/\\/g, '/');
    if (statSync(p).isDirectory()) { if (!/node_modules|\.next/.test(name)) walk(root, p, out); }
    else if (p.endsWith('.tsx') && !isExcluded(rel)) out.push(rel);
  }
  return out;
}

export function scan(root) {
  const files = SCOPES.flatMap((scope) => walk(root, join(root, scope), []));
  return files.flatMap((rel) => scanSource(readFileSync(join(root, rel), 'utf8'), rel));
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
