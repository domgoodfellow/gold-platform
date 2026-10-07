import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const WEB_ROOT = path.resolve(SCRIPT_DIR, '../..');
const E2E_ROOT = path.resolve(WEB_ROOT, 'e2e');
const contextPath = path.resolve(E2E_ROOT, '.demo-context.json');
const storageState = path.resolve(E2E_ROOT, '.auth', 'owner.json');
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const outputRoot = path.resolve(WEB_ROOT, '../../docs/audits/ui-captures');
const viewport = { width: 1440, height: 900 };
const maxPages = Number(process.env.UI_AUDIT_MAX_PAGES ?? 180);

const demo = JSON.parse(readFileSync(contextPath, 'utf8'));
const organizationPrefix = `/organizations/${demo.organizationId}`;

const seeds = [
  `${organizationPrefix}/home`,
  `${organizationPrefix}/library`,
  `${organizationPrefix}/sales`,
  `${organizationPrefix}/comms`,
  `${organizationPrefix}/finance`,
  `${organizationPrefix}/automations`,
  `${organizationPrefix}/field`,
  `${organizationPrefix}/studio`,
  `${organizationPrefix}/settings`,
];

function normalize(raw) {
  const url = new URL(raw, baseURL);
  if (url.origin !== new URL(baseURL).origin) return null;
  if (!url.pathname.startsWith(organizationPrefix)) return null;
  if (/\/download(?:\/|$)/.test(url.pathname)) return null;

  // Keep only URL state that represents a sibling surface. Drop ephemeral record/search state so
  // one collection cannot explode into hundreds of audit captures.
  const kept = new URLSearchParams();
  for (const key of ['view', 'tab']) {
    const value = url.searchParams.get(key);
    if (value) kept.set(key, value);
  }
  const query = kept.toString();
  return `${url.pathname}${query ? `?${query}` : ''}`;
}

function slug(url) {
  return url
    .replace(organizationPrefix, 'org')
    .replace(/^\//, '')
    .replace(/[?&=\/\[\]]+/g, '__')
    .replace(/[^a-zA-Z0-9_.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180);
}

mkdirSync(outputRoot, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL,
  storageState,
  viewport,
  colorScheme: 'light',
  reducedMotion: 'reduce',
});
const page = await context.newPage();

const queue = [...new Set(seeds.map(normalize).filter(Boolean))];
const queued = new Set(queue);
const visited = new Set();
const report = [];

while (queue.length && visited.size < maxPages) {
  const url = queue.shift();
  if (!url || visited.has(url)) continue;
  visited.add(url);

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];

  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error) => pageErrors.push(String(error));
  const onRequestFailed = (request) => failedRequests.push({
    url: request.url(),
    error: request.failure()?.errorText ?? 'request failed',
  });

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);

  let status = null;
  let title = '';
  let screenshot = null;
  let navigationError = null;

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle' });
    status = response?.status() ?? null;
    title = await page.title();

    screenshot = `${String(visited.size).padStart(3, '0')}__${slug(url)}.png`;
    await page.screenshot({
      path: path.join(outputRoot, screenshot),
      fullPage: true,
      animations: 'disabled',
    });

    const links = await page.locator('a[href]').evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href')).filter(Boolean)
    );
    for (const href of links) {
      const next = normalize(href);
      if (next && !visited.has(next) && !queued.has(next)) {
        queued.add(next);
        queue.push(next);
      }
    }
  } catch (error) {
    navigationError = String(error);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
    page.off('requestfailed', onRequestFailed);
  }

  report.push({
    url,
    status,
    title,
    screenshot,
    consoleErrors,
    pageErrors,
    failedRequests,
    navigationError,
  });

  process.stdout.write(`[${visited.size}/${maxPages}] ${url} ${status ?? 'ERR'}\n`);
}

await browser.close();

const jsonPath = path.join(outputRoot, 'report.json');
writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  baseURL,
  organizationId: demo.organizationId,
  viewport,
  maxPages,
  reached: report.length,
  remainingQueue: queue.length,
  surfaces: report,
}, null, 2));

const markdown = [
  '# UI capture audit',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Reached **${report.length}** surfaces. ${queue.length ? `Stopped with **${queue.length}** queued because UI_AUDIT_MAX_PAGES=${maxPages}.` : ''}`,
  '',
  '| Surface | HTTP | Screenshot | Runtime signals |',
  '|---|---:|---|---|',
  ...report.map((entry) => {
    const signals = [
      entry.navigationError ? 'navigation error' : null,
      entry.consoleErrors.length ? `${entry.consoleErrors.length} console error(s)` : null,
      entry.pageErrors.length ? `${entry.pageErrors.length} page error(s)` : null,
      entry.failedRequests.length ? `${entry.failedRequests.length} failed request(s)` : null,
    ].filter(Boolean).join(', ') || '—';
    return `| \`${entry.url}\` | ${entry.status ?? '—'} | ${entry.screenshot ? `\`${entry.screenshot}\`` : '—'} | ${signals} |`;
  }),
  '',
  'Detailed runtime signals are in `report.json`.',
  '',
].join('\n');

writeFileSync(path.join(outputRoot, 'README.md'), markdown);
process.stdout.write(`Wrote ${outputRoot}\n`);
