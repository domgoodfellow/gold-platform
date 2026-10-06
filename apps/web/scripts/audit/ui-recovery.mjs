import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(webRoot, '../..');
const outDir = path.join(repoRoot, 'docs/ui-recovery/phase-0');

async function walk(root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}
const slash = (value) => value.split(path.sep).join('/');
const relative = (root, file) => slash(path.relative(root, file));
function routeOf(rel) {
  return '/' + rel
    .replace(/^app\//, '')
    .replace(/\/page\.(?:tsx|ts|jsx|js)$/, '')
    .split('/')
    .filter((segment) => !/^\(.+\)$/.test(segment))
    .join('/');
}
function scopeOf(rel) {
  if (rel.startsWith('app/(auth)/')) return 'AUTH';
  if (rel.startsWith('app/(marketing)/')) return 'PUBLIC_MARKETING';
  if (rel.startsWith('app/(public)/') || rel.startsWith('app/(embed)/')) return 'PUBLIC_CUSTOMER';
  if (rel.startsWith('app/(preview)/')) return 'PREVIEW';
  if (rel.startsWith('app/settings/')) return 'PERSONAL';
  if (rel.startsWith('app/platform/')) return 'PLATFORM_COMPAT';
  if (rel.includes('/platform/')) return 'PLATFORM';
  if (rel.startsWith('app/organizations/')) return 'ORGANIZATION';
  return 'ROOT';
}
function typeOf(rel, route) {
  if (rel.includes('/settings/') || route.endsWith('/settings')) return route.endsWith('/settings') ? 'settings_index' : 'settings_detail';
  if (rel.includes('/platform/')) return /\[[^\]]+\]/.test(rel.replace('app/organizations/[organizationId]/platform/', '')) ? 'platform_detail' : 'platform_control_plane';
  if (route.endsWith('/configuration') || rel.includes('/configure/')) return 'configuration';
  if (rel.includes('/new/')) return 'create';
  if (/\[(?!organizationId|slug|hostname|publicKey|revisionId|token)[^\]]+\]/.test(rel)) return 'record_detail';
  if (/\/(home|sales|finance|field|studio|automations|comms|library|insights)\/page\.tsx$/.test(rel)) return 'workspace_or_domain_home';
  if (rel.startsWith('app/(auth)/')) return 'auth';
  if (rel.startsWith('app/(marketing)/')) return 'marketing';
  if (rel.startsWith('app/(public)/') || rel.startsWith('app/(embed)/')) return 'public_experience';
  return 'collection_or_page';
}
function ownerOf(route) {
  const match = route.match(/^\/organizations\/\[organizationId\]\/([^/]+)/);
  if (!match) return null;
  const map = {
    home: 'Home', customers: 'CRM', sales: 'CRM', comms: 'Communications', calls: 'Communications',
    finance: 'Finance', automations: 'Automations', field: 'Field', fields: 'Field', work: 'Field',
    schedule: 'Field', resources: 'Field', locations: 'Field', assets: 'Field', studio: 'Studio',
    library: 'Library', insights: 'Shared Insights', settings: 'Settings', setup: 'Setup',
    platform: 'Platform Administration', integrations: 'Connections', pricing: 'Settings', roles: 'Access',
  };
  return map[match[1]] ?? match[1];
}
const identityPatterns = ['PageHeader', 'CollectionHeader', 'WorkspaceHome', 'SettingsPageFrame', 'StatePage', 'RecordHeader'];
const sharedPatterns = [...identityPatterns, 'AppPage', 'CollectionView', 'DataTable', 'Card', 'Section', 'EmptyState', 'ViewNav'];
function allMatches(source, rx) { return [...source.matchAll(rx)].map((match) => match[1]); }
function tokens(source, rx) {
  const classes = allMatches(source, /className\s*=\s*["'`]([^"'`]+)["'`]/g);
  return [...new Set(classes.flatMap((value) => value.split(/\s+/)).filter((value) => rx.test(value)))].sort();
}
function inc(record, key) { record[key] = (record[key] ?? 0) + 1; }

await mkdir(outDir, { recursive: true });
const appFiles = (await walk(path.join(webRoot, 'app'))).filter((file) => /page\.(tsx|ts|jsx|js)$/.test(file));
const surfaces = [];
for (const [index, file] of appFiles.sort().entries()) {
  const rel = relative(webRoot, file);
  const route = routeOf(rel);
  const source = await readFile(file, 'utf8');
  const imports = allMatches(source, /from\s+['"]([^'"]+)['"]/g);
  const patterns = sharedPatterns.filter((name) => new RegExp('\\b' + name + '\\b').test(source));
  surfaces.push({
    surface_id: 'SURF-' + String(index + 1).padStart(3, '0'),
    source_file: 'apps/web/' + rel,
    route,
    scope: scopeOf(rel),
    owner: ownerOf(route),
    surface_type: typeOf(rel, route),
    dynamic_segments: allMatches(route, /\[([^\]]+)\]/g),
    shared_patterns: patterns,
    identity_pattern: identityPatterns.find((name) => patterns.includes(name)) ?? null,
    direct_h1: /<h1\b/.test(source),
    direct_gold_ui_imports: imports.filter((value) => value.startsWith('@gold/ui/')),
    shared_component_imports: imports.filter((value) => value.startsWith('@/components/')),
    spacing_tokens: tokens(source, /^(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-/),
    width_tokens: tokens(source, /^(?:max-w|min-w|w)-/),
  });
}
const webComponents = (await walk(path.join(webRoot, 'components'))).filter((file) => /\.(tsx|ts|md)$/.test(file)).sort();
const shared = webComponents.map((file, index) => {
  const rel = relative(path.join(webRoot, 'components'), file);
  const first = rel.split('/')[0];
  return { id: 'SHARED-' + String(index + 1).padStart(3, '0'), source_file: 'apps/web/components/' + rel, category: first.includes('.') ? 'root' : first };
});
const primitiveRoot = path.join(repoRoot, 'packages/ui/src/components');
const primitives = (await walk(primitiveRoot)).filter((file) => /\.(tsx|ts)$/.test(file)).sort().map((file, index) => ({
  id: 'PRIM-' + String(index + 1).padStart(3, '0'),
  source_file: 'packages/ui/src/components/' + relative(primitiveRoot, file),
  name: path.basename(file).replace(/\.(tsx|ts)$/, ''),
}));
const by = (items, key) => items.reduce((result, item) => { inc(result, item[key] ?? 'null'); return result; }, {});
const patternUsage = {}, spacingUsage = {}, widthUsage = {};
for (const surface of surfaces) {
  for (const value of surface.shared_patterns) inc(patternUsage, value);
  for (const value of surface.spacing_tokens) inc(spacingUsage, value);
  for (const value of surface.width_tokens) inc(widthUsage, value);
}
const baseline = { generated_at: new Date().toISOString(), source: 'working tree' };
await writeFile(path.join(outDir, '02-surface-inventory.json'), JSON.stringify({
  schema_version: 2, baseline,
  counts: { total: surfaces.length, by_scope: by(surfaces, 'scope'), by_surface_type: by(surfaces, 'surface_type') },
  surfaces,
}, null, 2) + '\n');
await writeFile(path.join(outDir, '03-shared-surface-inventory.json'), JSON.stringify({
  schema_version: 2, baseline,
  counts: { shared_application_files: shared.length, ui_primitives: primitives.length, by_category: by(shared, 'category') },
  shared_application: shared, ui_primitives: primitives,
}, null, 2) + '\n');
const flagged = {
  pages_without_known_identity: surfaces.filter((surface) => !surface.identity_pattern).map((surface) => surface.source_file),
  pages_with_direct_h1: surfaces.filter((surface) => surface.direct_h1).map((surface) => surface.source_file),
  pages_importing_gold_ui_directly: surfaces.filter((surface) => surface.direct_gold_ui_imports.length).map((surface) => ({
    file: surface.source_file, imports: surface.direct_gold_ui_imports,
  })),
  pages_with_page_local_width_tokens: surfaces.filter((surface) => surface.width_tokens.length).map((surface) => ({
    file: surface.source_file, tokens: surface.width_tokens,
  })),
};
await writeFile(path.join(outDir, '04-pattern-matrix.json'), JSON.stringify({
  schema_version: 1, baseline,
  totals: { surfaces: surfaces.length, shared_application_files: shared.length, ui_primitives: primitives.length },
  pattern_usage: patternUsage, spacing_token_usage: spacingUsage, width_token_usage: widthUsage, flagged,
}, null, 2) + '\n');
const top = (record, n = 25) => Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const report = [
  '# Pattern inconsistency report', '',
  'Generated from the current working tree by `scripts/audit/ui-recovery.mjs`.', '',
  '## Counts', '',
  '- Routed page surfaces: **' + surfaces.length + '**',
  '- Shared application UI files: **' + shared.length + '**',
  '- Source-owned UI primitives: **' + primitives.length + '**',
  '- Pages without a recognized shared identity composition: **' + flagged.pages_without_known_identity.length + '**',
  '- Pages containing a direct `<h1>`: **' + flagged.pages_with_direct_h1.length + '**',
  '- Pages importing `@gold/ui` directly: **' + flagged.pages_importing_gold_ui_directly.length + '**', '',
  '## Shared-pattern usage', '',
  ...top(patternUsage).map(([name, count]) => '- `' + name + '`: ' + count), '',
  '## Most common page-local spacing tokens', '',
  ...top(spacingUsage).map(([name, count]) => '- `' + name + '`: ' + count), '',
  '## Most common page-local width tokens', '',
  ...top(widthUsage).map(([name, count]) => '- `' + name + '`: ' + count), '',
  '## Interpretation rule', '',
  'These counts identify divergence candidates; they do not declare every difference a defect. A migration finding must still classify whether the difference expresses a real archetype/state requirement or accidental drift.', '',
].join('\n');
await writeFile(path.join(outDir, '04-pattern-inconsistency.md'), report);
console.log(JSON.stringify({ surfaces: surfaces.length, shared: shared.length, primitives: primitives.length, flagged: Object.fromEntries(Object.entries(flagged).map(([k,v]) => [k, v.length])) }, null, 2));
