import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadDemoContext, OWNER_STORAGE_STATE, STAFF_STORAGE_STATE } from '../e2e/helpers';

type Surface = {
  surface_id: string;
  route: string;
  scope: string;
  source_file: string;
};

type Capture = {
  url: string;
  pathname: string;
  title: string;
  status: 'captured' | 'failed';
  screenshot?: string;
  matched_surface_id?: string;
  matched_route?: string;
  console_errors: string[];
  failed_requests: string[];
  error?: string;
};

const repoRoot = path.resolve(__dirname, '../../..');
const inventoryPath = path.join(repoRoot, 'docs/ui-recovery/phase-0/02-surface-inventory.json');
const artifactRoot = path.join(repoRoot, '.artifacts/ui-audit');

function escapeRegex(value: string) {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, '\\$&');
}

function routeRegex(template: string): RegExp {
  const parts = template.split('/').map((segment) => {
    if (/^\[\.\.\..+\]$/.test(segment)) return '.*';
    if (/^\[.+\]$/.test(segment)) return '[^/]+';
    return escapeRegex(segment);
  });
  return new RegExp('^' + parts.join('/') + '/?$');
}

function matchSurface(pathname: string, surfaces: Surface[]) {
  return surfaces.find((surface) => routeRegex(surface.route).test(pathname));
}

function safeName(pathname: string) {
  return pathname.replace(/^\//, '').replace(/[^a-zA-Z0-9._-]+/g, '__') || 'root';
}

function eligibleHref(raw: string | null, origin: string) {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return null;
  if (url.pathname.includes('/sign-out') || url.pathname.includes('/logout')) return null;
  url.hash = '';
  return url.pathname + url.search;
}

async function makeContext(
  browser: Browser,
  storageState: string | undefined,
  viewport: { width: number; height: number },
) {
  return browser.newContext({
    storageState,
    viewport,
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
}

async function crawl(
  context: BrowserContext,
  roots: string[],
  surfaces: Surface[],
  project: string,
): Promise<Capture[]> {
  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  const origin = new URL(baseURL).origin;
  const queue = [...roots];
  const queued = new Set(queue);
  const visited = new Set<string>();
  const captures: Capture[] = [];
  const dir = path.join(artifactRoot, project);
  await mkdir(path.join(dir, 'screenshots'), { recursive: true });

  while (queue.length > 0 && visited.size < 500) {
    const target = queue.shift()!;
    if (visited.has(target)) continue;
    visited.add(target);

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));
    page.on('requestfailed', (request) => failedRequests.push(request.url()));

    try {
      const response = await page.goto(target, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

      const pathname = new URL(page.url()).pathname;
      const matched = matchSurface(pathname, surfaces);
      const fileName = safeName(pathname) + '.png';

      await page.screenshot({
        path: path.join(dir, 'screenshots', fileName),
        fullPage: true,
        animations: 'disabled',
      });

      captures.push({
        url: page.url(),
        pathname,
        title: await page.title(),
        status: 'captured',
        screenshot: 'screenshots/' + fileName,
        matched_surface_id: matched?.surface_id,
        matched_route: matched?.route,
        console_errors: consoleErrors,
        failed_requests: failedRequests,
      });

      const hrefs = await page
        .locator('a[href]')
        .evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute('href')));

      for (const raw of hrefs) {
        const next = eligibleHref(raw, origin);
        if (!next || queued.has(next) || visited.has(next)) continue;
        queued.add(next);
        queue.push(next);
      }

      if (response && response.status() >= 500) {
        captures[captures.length - 1].error = 'HTTP ' + response.status();
      }
    } catch (error) {
      captures.push({
        url: target,
        pathname: target.split('?')[0],
        title: '',
        status: 'failed',
        console_errors: consoleErrors,
        failed_requests: failedRequests,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await page.close();
    }
  }

  return captures;
}

test('exhaustive reachable surface audit', async ({ browser }, testInfo) => {
  const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as { surfaces: Surface[] };
  const demo = loadDemoContext();
  const viewport = testInfo.project.use.viewport as { width: number; height: number };

  const owner = await makeContext(browser, OWNER_STORAGE_STATE, viewport);
  const staff = await makeContext(browser, STAFF_STORAGE_STATE, viewport);
  const publicContext = await makeContext(browser, undefined, viewport);

  const ownerRoots = [
    '/organizations/' + demo.organizationId + '/home',
    '/organizations/' + demo.organizationId + '/settings',
    '/settings/account?org=' + demo.organizationId,
    '/organizations',
  ];
  const staffRoots = [
    '/organizations/' + demo.goldOrganizationId + '/platform',
  ];
  const publicRoots = ['/', '/login'];

  const captures = [
    ...await crawl(owner, ownerRoots, inventory.surfaces, testInfo.project.name + '/owner'),
    ...await crawl(staff, staffRoots, inventory.surfaces, testInfo.project.name + '/staff'),
    ...await crawl(publicContext, publicRoots, inventory.surfaces, testInfo.project.name + '/public'),
  ];

  await owner.close();
  await staff.close();
  await publicContext.close();

  const covered = new Set(
    captures.map((capture) => capture.matched_surface_id).filter(Boolean),
  );
  const uncovered = inventory.surfaces.filter(
    (surface) => !covered.has(surface.surface_id),
  );

  const manifest = {
    generated_at: new Date().toISOString(),
    project: testInfo.project.name,
    viewport,
    captures,
    coverage: {
      inventory_total: inventory.surfaces.length,
      matched_templates: covered.size,
      unmatched_templates: uncovered.map((surface) => ({
        surface_id: surface.surface_id,
        route: surface.route,
        source_file: surface.source_file,
        scope: surface.scope,
      })),
    },
  };

  const output = path.join(artifactRoot, testInfo.project.name, 'manifest.json');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(manifest, null, 2) + '\n');

  expect(captures.length).toBeGreaterThan(0);
});
