import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const root = path.join(repoRoot, '.artifacts/ui-audit');

const projects = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const manifests = [];
for (const project of projects) {
  try {
    manifests.push(JSON.parse(await readFile(path.join(root, project, 'manifest.json'), 'utf8')));
  } catch {
    // A viewport that did not run should not prevent reading the others.
  }
}

const escape = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const cards = manifests.flatMap((manifest) =>
  manifest.captures
    .filter((capture) => capture.status === 'captured')
    .map((capture) => {
      const src = manifest.project + '/' + capture.screenshot;
      const errors = capture.console_errors.length + capture.failed_requests.length;
      return '<article>' +
        '<a href="' + escape(src) + '"><img loading="lazy" src="' + escape(src) + '" alt=""></a>' +
        '<div><strong>' + escape(capture.pathname) + '</strong><br>' +
        '<small>' + escape(manifest.project) + ' · ' + escape(capture.matched_surface_id ?? 'unmatched') +
        ' · runtime issues ' + errors + '</small></div></article>';
    }),
);

const coverage = manifests.map((manifest) =>
  '<li><strong>' + escape(manifest.project) + '</strong>: ' +
  manifest.coverage.matched_templates + '/' + manifest.coverage.inventory_total +
  ' route templates reached; ' + manifest.coverage.unmatched_templates.length + ' unmatched.</li>',
).join('');

const html = '<!doctype html><meta charset="utf-8"><title>GildOps UI audit</title>' +
  '<style>body{font-family:system-ui;margin:24px;background:#f6f6f6;color:#111}' +
  'ul{margin-bottom:24px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}' +
  'article{background:white;border:1px solid #ddd;border-radius:10px;overflow:hidden}' +
  'img{width:100%;display:block;border-bottom:1px solid #ddd}' +
  'article div{padding:10px;overflow-wrap:anywhere}</style>' +
  '<h1>GildOps UI audit</h1><ul>' + coverage + '</ul><div class="grid">' + cards.join('') + '</div>';

await writeFile(path.join(root, 'index.html'), html);
console.log('Wrote ' + path.join(root, 'index.html'));
