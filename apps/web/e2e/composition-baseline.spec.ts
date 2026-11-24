import { test, expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createWebsite, listSiteTemplates } from '../lib/domain/public-site/public-site';
import type { Db } from '../lib/db/types';

/**
 * Composition baseline (UI composition initiative, Phase 0). Captures representative operator pages —
 * one or more of every archetype across the workspaces — at the shell's real width classes, the three
 * personal Appearance densities and the shell states that change the working area (collapsed sidebar,
 * open support rail). Alongside each capture it records the geometry the composition contracts are
 * about: the page-header band, the gap from it to the first content, the gaps between the page's
 * stacked regions, panel-header heights and header-control heights.
 *
 * It asserts only that each page rendered without horizontal overflow; the measurements are evidence
 * for review and for later phases' geometry assertions, never a pass/fail threshold here.
 * `COMPOSITION_PHASE` names the capture set (default `after`), written under the ignored
 * `.artifacts/composition-baseline/<phase>/`.
 */
const phase = process.env.COMPOSITION_PHASE ?? 'after';
const out = path.join(__dirname, '../../../.artifacts/composition-baseline', phase);
// No trace: one ten-minute capture's trace fails to close on Windows, and the screenshots and metrics are the evidence.
test.use({ storageState: OWNER_STORAGE_STATE, trace: 'off' });

type Metrics = Awaited<ReturnType<typeof measure>>;

async function measure(page: Page) {
  return page.evaluate(() => {
    const visible = (element: Element) => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed'; };
    const round = (value: number) => Math.round(value * 10) / 10;
    const main = document.querySelector('main');
    const h1 = main?.querySelector('h1');
    const header = h1?.closest('[data-slot=page-header], [data-slot=workspace-intro], header:not(main > header)') ?? null;
    const frame = header?.parentElement ?? null;
    const canvas = frame?.closest('main')?.querySelector(':scope > div [class*="p-4"]') ?? null;
    const headerBox = header?.getBoundingClientRect();
    const visibleInHeader = header ? [...header.querySelectorAll('*')].filter(element => visible(element) && !element.closest('.sr-only')).length : 0;
    const stack = frame ? [...frame.children].filter(visible) : [];
    const gaps = stack.slice(1).map((element, index) => round(element.getBoundingClientRect().top - stack[index].getBoundingClientRect().bottom));
    const firstAfterHeader = header ? stack.find(element => element !== header && element.getBoundingClientRect().top >= (headerBox?.top ?? 0) && !header.contains(element)) : undefined;
    const panelHeaders = [...document.querySelectorAll('[data-slot=operational-panel] > div:first-child')].filter(visible).map(element => round(element.getBoundingClientRect().height));
    const controls = header ? [...header.querySelectorAll('[data-header-controls] > *, [data-slot=workspace-intro] > div > *')].filter(visible).map(element => ({ tag: element.tagName.toLowerCase(), text: (element.textContent ?? '').trim().slice(0, 40), height: round(element.getBoundingClientRect().height), top: round(element.getBoundingClientRect().top) })) : [];
    return {
      title: h1?.textContent?.trim() ?? null,
      h1Hidden: h1 ? h1.closest('.sr-only') !== null : null,
      header: headerBox ? { kind: header!.getAttribute('data-slot') ?? header!.tagName.toLowerCase(), top: round(headerBox.top), height: round(headerBox.height), marginBottom: getComputedStyle(header!).marginBottom, visibleDescendants: visibleInHeader } : null,
      frameTop: frame ? round(frame.getBoundingClientRect().top) : null,
      canvasPadding: canvas ? getComputedStyle(canvas).paddingTop : null,
      headerToContent: headerBox && firstAfterHeader ? round(firstAfterHeader.getBoundingClientRect().top - headerBox.bottom) : null,
      firstContentTop: firstAfterHeader ? round(firstAfterHeader.getBoundingClientRect().top) : null,
      stackGaps: gaps,
      panelHeaders: [...new Set(panelHeaders)].sort((a, b) => a - b),
      panelCount: panelHeaders.length,
      controls,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
}

test('composition baseline across archetypes, widths, densities and shell states', async ({ page, context, baseURL }) => {
  test.setTimeout(3_600_000);
  mkdirSync(out, { recursive: true });
  const { organizationId, ownerEmail, customerId, workItemId } = loadDemoContext();
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  const userId = signed.data.user!.id;
  // An editor needs a working revision; the fixture business has none.
  const templates = await listSiteTemplates(db as Db);
  await createWebsite(db as Db, { organizationId, templateKey: templates[0]?.key }).catch(() => undefined);

  const org = `/organizations/${organizationId}`;
  // [name, archetype, route]
  const routes: [string, string, string][] = [
    ['home', 'workspace-dashboard', `${org}/home`],
    ['studio', 'workspace-dashboard', `${org}/studio`],
    ['crm', 'workspace-dashboard', `${org}/crm`],
    ['finance', 'workspace-dashboard', `${org}/finance`],
    ['work', 'workspace-dashboard', `${org}/field`],
    ['comms', 'workspace-dashboard', `${org}/comms`],
    ['ai', 'workspace-dashboard', `${org}/ai`],
    ['automations', 'workspace-dashboard', `${org}/automations`],
    ['support', 'workspace-dashboard', `${org}/support`],
    ['marketing', 'workspace-dashboard', `${org}/marketing`],
    ['crm-contacts', 'collection', `${org}/crm/contacts`],
    ['crm-pipeline', 'board', `${org}/crm/pipeline`],
    ['finance-invoices', 'collection', `${org}/finance/invoices`],
    ['work-items', 'collection', `${org}/work`],
    ['studio-forms', 'collection', `${org}/studio/forms`],
    ['automations-workflows', 'collection', `${org}/automations/workflows`],
    ['support-cases', 'collection', `${org}/support/cases`],
    ['marketing-campaigns', 'collection', `${org}/marketing/campaigns`],
    ['library-files', 'collection', `${org}/library/files`],
    ['comms-inbox', 'operational-console', `${org}/comms/inbox`],
    ['schedule', 'operational-console', `${org}/schedule`],
    ['contact-record', 'record', `${org}/crm/contacts/${customerId}`],
    ['work-record', 'record', `${org}/work/${workItemId}`],
    ['website-editor', 'editor', `${org}/studio/website`],
    ['settings-general', 'configuration', `${org}/settings/general`],
    ['settings-members', 'configuration', `${org}/settings/access/members`],
    ['help', 'reading', `${org}/help`],
  ];
  const results: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const setDensity = async (density: 'compact' | 'comfortable' | null) => {
    const saved = await db.from('account_appearance_preferences').upsert({ user_id: userId, density });
    if (saved.error) throw saved.error;
  };
  const setSidebar = (open: boolean) => context.addCookies([{ name: 'sidebar_state', value: String(open), url: baseURL! }]);

  const capture = async (state: string, routeList = routes, after?: (name: string) => Promise<string | null>) => {
    for (const [name, archetype, route] of routeList) {
      const response = await page.goto(route);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      const finalPath = new URL(page.url()).pathname.replace(organizationId, ':org');
      let variant = state;
      if (after) { const extra = await after(name); if (extra === null) continue; variant = `${state}-${extra}`; }
      const metrics: Metrics = await measure(page);
      await page.screenshot({ path: path.join(out, `${name}--${variant}.png`) });
      results.push({ name, archetype, state: variant, status: response?.status() ?? null, path: finalPath, ...metrics });
      expect.soft(metrics.overflow, `${name} ${variant} overflows horizontally`).toBe(false);
    }
  };

  try {
    await setDensity(null);
    for (const [width, height] of [[1440, 900], [1024, 800], [768, 1024], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await setSidebar(true);
      await capture(`w${width}-default`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await setSidebar(false);
    await capture('w1440-default-collapsed');
    await setSidebar(true);
    for (const density of ['compact', 'comfortable'] as const) {
      await setDensity(density);
      await capture(`w1440-${density}`);
      await page.setViewportSize({ width: 1024, height: 800 });
      await capture(`w1024-${density}`, routes.filter(([, archetype]) => archetype !== 'reading'));
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await setDensity(null);
    // An open support rail narrows the working area without changing the viewport.
    const withRail = routes.filter(([name]) => ['crm', 'crm-contacts', 'work-items', 'support'].includes(name));
    for (const [width, height] of [[1440, 900], [1280, 800]] as const) {
      await page.setViewportSize({ width, height });
      await capture(`w${width}-default`, withRail, async () => {
        const trigger = page.getByRole('button', { name: /^(Activity|Insights|Configure|Settings)$/ }).first();
        if (!(await trigger.count())) return null;
        const label = (await trigger.textContent())?.trim().toLowerCase() ?? 'rail';
        await trigger.click();
        await page.waitForTimeout(400);
        return `rail-${label}`;
      });
    }
  } finally {
    await setDensity(null).catch(() => undefined);
    await db.from('account_appearance_preferences').delete().eq('user_id', userId);
    writeFileSync(path.join(out, 'metrics.json'), JSON.stringify({ phase, captured: new Date().toISOString(), errors, results }, null, 2));
  }
});
