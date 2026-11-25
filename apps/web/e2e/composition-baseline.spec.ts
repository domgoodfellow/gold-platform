import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createWebsite, listSiteTemplates } from '../lib/domain/public-site/public-site';
import { saveCalendarEvent } from '../lib/domain/calendar/events';
import { BUCKET, uploadDocument } from '../lib/domain/documents/documents';
import { supabaseFileStore } from '../lib/adapters/storage/supabase-file-store';
import { localDateTimeToInstant, shiftDate, todayInZone } from '../lib/domain/scheduling/window';
import type { Db } from '../lib/db/types';

/**
 * Composition baseline and contracts (UI composition initiative). Two kinds of check share this file.
 *
 * The captures (`capture` in the title) record representative operator pages — one or more of every
 * archetype across the workspaces, Administration included — at the shell's real width classes, the
 * three personal Appearance densities and the shell states that change the working area (collapsed
 * sidebar, open support rail), empty and populated. Beside each screenshot they record the geometry
 * the composition contracts are about. They assert only that each intended page rendered and has no
 * horizontal overflow; the measurements are evidence for review. `COMPOSITION_PHASE` names the capture
 * set (default `after`), written under the ignored `.artifacts/composition-baseline/<phase>/`.
 *
 * The contract test asserts the page-geometry contracts on every operator destination with a fixed
 * address (`docs/ui-system.md`, Vertical rhythm): the page frame owns the space between its regions,
 * no region adds its own outer margin, a header with nothing visible takes no space, and nothing
 * overflows — at desktop and phone, at each density, and with a support rail open.
 */
const phase = process.env.COMPOSITION_PHASE ?? 'after';
const out = path.join(__dirname, '../../../.artifacts/composition-baseline', phase);
// No trace: one long capture's trace fails to close on Windows, and the screenshots and metrics are the evidence.
test.use({ storageState: OWNER_STORAGE_STATE, trace: 'off' });

type Metrics = Awaited<ReturnType<typeof measure>>;

async function measure(page: Page) {
  return page.evaluate(() => {
    const round = (value: number) => Math.round(value * 10) / 10;
    const inFlow = (element: Element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed' && style.visibility !== 'hidden';
    };
    // `checkVisibility` also treats a closed disclosure's content as hidden.
    const visible = (element: Element) => { const box = element.getBoundingClientRect(); return box.width > 1 && box.height > 1 && inFlow(element) && element.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }); };
    const describe = (element: Element) => {
      const slot = element.getAttribute('data-slot');
      const label = element.getAttribute('aria-label');
      const id = element.id;
      return `${element.tagName.toLowerCase()}${slot ? `[${slot}]` : ''}${label ? `"${label.slice(0, 30)}"` : ''}${id ? `#${id}` : ''}${!slot && !label && !id && typeof element.className === 'string' ? `.${element.className.split(' ').slice(0, 3).join('.')}` : ''}`;
    };
    const main = document.querySelector('main');
    const h1 = main?.querySelector('h1');
    const framed = main?.querySelector('[data-app-page]') ?? null;
    const header = (framed ?? main)?.querySelector('[data-slot=page-header], [data-slot=workspace-intro]') ?? h1?.closest('header:not(main > header)') ?? null;
    const frame = framed ?? header?.parentElement ?? null;
    const headerBox = header?.getBoundingClientRect();
    const headerInFlow = header ? inFlow(header) : null;
    const visibleInHeader = header ? [...header.querySelectorAll('*')].filter(element => visible(element) && !element.closest('.sr-only')).length : 0;
    const regions = frame ? [...frame.children].filter(inFlow) : [];
    const stack = regions.filter(visible);
    const gaps = stack.slice(1).map((element, index) => round(element.getBoundingClientRect().top - stack[index].getBoundingClientRect().bottom));
    const frameStyle = frame ? getComputedStyle(frame) : null;
    const rowGap = frameStyle && frameStyle.rowGap !== 'normal' ? parseFloat(frameStyle.rowGap) : 0;
    const firstAfterHeader = stack.find(element => element !== header && !header?.contains(element));
    const regionMargins = regions.map(element => ({ element, style: getComputedStyle(element) }))
      .filter(({ style }) => parseFloat(style.marginTop) !== 0 || parseFloat(style.marginBottom) !== 0)
      .map(({ element, style }) => `${describe(element)} ${style.marginTop}/${style.marginBottom}`);
    const emptyRegions = regions.filter(element => element.getBoundingClientRect().height < 1).map(describe);
    const unevenGaps = stack.slice(1).map((element, index) => ({ element, gap: element.getBoundingClientRect().top - stack[index].getBoundingClientRect().bottom }))
      .filter(({ gap }) => Math.abs(gap - rowGap) > 1).map(({ element, gap }) => `${describe(element)} ${round(gap)}`);
    const panelHeaders = [...document.querySelectorAll('[data-slot=operational-panel] > div:first-child')].filter(visible).map(element => round(element.getBoundingClientRect().height));
    const controls = header ? [...header.querySelectorAll('[data-header-controls] > *, [data-slot=workspace-intro] > div > *')].filter(visible).map(element => ({ tag: element.tagName.toLowerCase(), text: (element.textContent ?? '').trim().slice(0, 40), height: round(element.getBoundingClientRect().height), top: round(element.getBoundingClientRect().top) })) : [];
    // Controls in the page's own control regions; a target under 24px fails WCAG 2.2 target size.
    const targets = [...(main?.querySelectorAll(':is([data-header-controls], [data-slot=collection-toolbar], [data-slot=calendar-toolbar]) :is(a[href], button, input:not([type=hidden]), select, summary, label[for])') ?? [])]
      .filter(element => visible(element) && !element.closest('.sr-only, [hidden], [data-slot=filter-panel]'))
      .map(element => ({ name: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30), box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 24 || box.width < 24)
      .map(({ name, box }) => `${name} ${round(box.width)}x${round(box.height)}`);
    const board = main?.querySelector('[data-slot=calendar-board]') ?? main?.querySelector('[aria-label$=" calendar"]:not(nav):not(form)');
    // The development overlay is always mounted; only an open error dialog inside it is an error page.
    const errorPage = Boolean(document.querySelector('nextjs-portal')?.shadowRoot?.querySelector('[data-nextjs-dialog], [data-nextjs-dialog-overlay]')) || /^(404|500)$/.test(h1?.textContent?.trim() ?? '') || /This page could not be found|Application error/.test(main?.textContent ?? '');
    return {
      title: h1?.textContent?.trim() ?? null,
      h1Hidden: h1 ? h1.closest('.sr-only') !== null : null,
      errorPage,
      framed: Boolean(framed),
      rowGap,
      header: headerBox ? { kind: header!.getAttribute('data-slot') ?? header!.tagName.toLowerCase(), inFlow: headerInFlow, top: round(headerBox.top), height: round(headerBox.height), marginBottom: getComputedStyle(header!).marginBottom, visibleDescendants: visibleInHeader } : null,
      frameTop: frame ? round(frame.getBoundingClientRect().top) : null,
      headerToContent: headerBox && headerInFlow && firstAfterHeader ? round(firstAfterHeader.getBoundingClientRect().top - headerBox.bottom) : null,
      firstContentTop: firstAfterHeader ? round(firstAfterHeader.getBoundingClientRect().top) : null,
      stackGaps: gaps,
      regionMargins,
      emptyRegions,
      unevenGaps,
      boardHeight: board ? round(board.getBoundingClientRect().height) : null,
      smallTargets: targets,
      panelHeaders: [...new Set(panelHeaders)].sort((a, b) => a - b),
      panelCount: panelHeaders.length,
      controls,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 || (main ? main.scrollWidth > main.clientWidth + 1 : false),
      // The innermost elements that reach past the working area's right edge, to name an overflow's cause.
      overflowing: main ? [...main.querySelectorAll('*')].filter(element => visible(element) && element.getBoundingClientRect().right > main.getBoundingClientRect().right + 1 && ![...element.children].some(child => child.getBoundingClientRect().right > main.getBoundingClientRect().right + 1)).slice(0, 4).map(element => `${describe(element)} ${round(element.getBoundingClientRect().width)}`) : [],
    };
  });
}

type Route = [name: string, archetype: string, route: string];
/** A real one-pixel PNG: uploads are checked against their declared type. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function captureRoutes(org: string, ids: { customerId: string; workItemId: string; assetId: string; locationId: string }): Route[] {
  return [
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
    ['crm-opportunities', 'collection', `${org}/crm/opportunities`],
    ['crm-tasks', 'collection', `${org}/crm/tasks`],
    ['finance-invoices', 'collection', `${org}/finance/invoices`],
    ['finance-catalog', 'collection', `${org}/finance/catalog`],
    ['work-items', 'collection', `${org}/work`],
    ['work-dispatch', 'operational-console', `${org}/work/dispatch`],
    ['studio-forms', 'collection', `${org}/studio/forms`],
    ['automations-workflows', 'collection', `${org}/automations/workflows`],
    ['support-cases', 'collection', `${org}/support/cases`],
    ['marketing-campaigns', 'collection', `${org}/marketing/campaigns`],
    ['library-files', 'collection', `${org}/library/files`],
    ['library-sources', 'collection', `${org}/library/sources`],
    ['library-media', 'collection', `${org}/library/media`],
    ['library-trash', 'collection', `${org}/library/trash`],
    ['comms-inbox', 'operational-console', `${org}/comms/inbox`],
    ['calendar', 'calendar', `${org}/calendar`],
    ['calendar-day', 'calendar', `${org}/calendar?view=day`],
    ['calendar-week', 'calendar', `${org}/calendar?view=week`],
    ['calendar-month', 'calendar', `${org}/calendar?view=month`],
    ['schedule', 'calendar', `${org}/schedule`],
    ['contact-record', 'record', `${org}/crm/contacts/${ids.customerId}`],
    ['work-record', 'record', `${org}/work/${ids.workItemId}`],
    ['asset-record', 'record', `${org}/assets/${ids.assetId}`],
    ['website-editor', 'editor', `${org}/studio/website`],
    ['setup', 'wizard', `${org}/setup`],
    ['settings-general', 'configuration', `${org}/settings/general`],
    ['settings-members', 'configuration', `${org}/settings/access/members`],
    ['settings-plan', 'configuration', `${org}/settings/plan`],
    ['work-configuration', 'configuration', `${org}/work/configuration`],
    ['help', 'reading', `${org}/help`],
  ];
}

const adminRoutes = (org: string): Route[] => [
  ['admin-overview', 'workspace-dashboard', `${org}/administration`],
  ['admin-organizations', 'collection', `${org}/administration/organizations`],
  ['admin-organization', 'record', `${org}/administration/organizations/${org.split('/').pop()}`],
  ['admin-catalog', 'collection', `${org}/administration/catalog`],
  ['admin-providers', 'collection', `${org}/administration/providers`],
  ['admin-failures', 'operational-console', `${org}/administration/failures`],
];

/** Pages the contract test visits: every operator destination with a fixed address that renders a page of its own. */
const contractPaths = [
  'home', 'calendar', 'schedule', 'schedule/configuration', 'help', 'help/contact', 'setup', 'assets', 'locations', 'resources', 'calls',
  'crm', 'crm/contacts', 'crm/contacts/stages', 'crm/pipeline', 'crm/opportunities', 'crm/tasks', 'crm/search', 'crm/configuration/fields', 'crm/configuration/opportunity-stages', 'crm/configuration/relationship-stages',
  'finance', 'finance/invoices', 'finance/quotes', 'finance/payments', 'finance/subscriptions', 'finance/catalog', 'finance/reports', 'finance/search', 'finance/costs', 'finance/economics', 'finance/economics/packages',
  'field', 'work', 'work/dispatch', 'work/configuration', 'work/new',
  'comms', 'comms/inbox', 'comms/configuration/calling', 'comms/configuration/email', 'comms/configuration/messaging', 'comms/configuration/numbers',
  'studio', 'studio/forms', 'studio/templates', 'studio/website', 'studio/portal', 'studio/interface/navigation',
  'ai', 'automations', 'automations/workflows', 'automations/runs', 'automations/messages',
  'support', 'support/cases', 'support/queues', 'support/service-levels', 'support/reports',
  'marketing', 'marketing/campaigns', 'marketing/leads', 'marketing/audiences', 'marketing/performance',
  'library/files', 'library/sources', 'library/collections', 'library/knowledge', 'library/media', 'library/templates', 'library/trash',
  'settings/general', 'settings/access/members', 'settings/access/roles', 'settings/access/invitations', 'settings/access/history', 'settings/branding', 'settings/email', 'settings/domains', 'settings/features', 'settings/payments', 'settings/plan', 'settings/public-profile', 'settings/terminology', 'settings/connections', 'settings/connections/mcp', 'settings/secrets',
  'support/configuration/queues', 'support/configuration/service-levels',
];

async function signIn(browser: Browser, baseURL: string, email: string) {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL(/\/organizations/, { timeout: 30_000 });
  return { context, page };
}

function fixture() {
  const ctx = loadDemoContext();
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  return { ctx, db, org: `/organizations/${ctx.organizationId}` };
}

/** Visits each route in each state, measuring and screenshotting it; a route that did not render as itself fails softly. */
function capturer(page: Page, organizationId: string, results: Record<string, unknown>[]) {
  return async (state: string, routes: Route[], after?: (name: string) => Promise<string | null>) => {
    for (const [name, archetype, route] of routes) {
      const response = await page.goto(route);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      const finalPath = new URL(page.url()).pathname;
      let variant = state;
      if (after) { const extra = await after(name); if (extra === null) continue; variant = `${state}-${extra}`; }
      const metrics: Metrics = await measure(page);
      await page.screenshot({ path: path.join(out, `${name}--${variant}.png`) });
      results.push({ name, archetype, state: variant, status: response?.status() ?? null, path: finalPath.replace(organizationId, ':org'), ...metrics });
      expect.soft(response?.status(), `${name} ${variant} status`).toBe(200);
      expect.soft(finalPath, `${name} ${variant} rendered at its own address`).toBe(new URL(route, 'http://x').pathname);
      expect.soft(metrics.errorPage, `${name} ${variant} rendered an error page`).toBe(false);
      expect.soft(metrics.overflow, `${name} ${variant} overflows horizontally`).toBe(false);
    }
  };
}

test('capture: composition baseline across archetypes, widths, densities, shell states and data states', async ({ page, context, baseURL }) => {
  test.setTimeout(3_600_000);
  mkdirSync(out, { recursive: true });
  const { ctx, db, org } = fixture();
  const signed = await db.auth.signInWithPassword({ email: ctx.ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  const userId = signed.data.user!.id;
  // An editor needs a working revision; the fixture business has none.
  const templates = await listSiteTemplates(db as Db);
  await createWebsite(db as Db, { organizationId: ctx.organizationId, templateKey: templates[0]?.key }).catch(() => undefined);

  const routes = captureRoutes(org, ctx);
  const results: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const capture = capturer(page, ctx.organizationId, results);
  const setDensity = async (density: 'compact' | 'comfortable' | null) => {
    const saved = await db.from('account_appearance_preferences').upsert({ user_id: userId, density });
    if (saved.error) throw saved.error;
  };
  const setSidebar = (open: boolean) => context.addCookies([{ name: 'sidebar_state', value: String(open), url: baseURL! }]);

  try {
    await setDensity(null);
    await setSidebar(true);
    // Empty states first: the fixture business has no Library files and no calendar events yet.
    const emptyRoutes = routes.filter(([name]) => ['library-files', 'calendar', 'calendar-week', 'calendar-month', 'schedule'].includes(name));
    for (const [width, height] of [[1440, 900], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await capture(`w${width}-empty`, emptyRoutes);
    }
    // Then populate them, as an operator would have.
    const organization = await db.from('organizations').select('timezone').eq('id', ctx.organizationId).single();
    const timezone = organization.data?.timezone ?? 'UTC';
    const today = todayInZone(timezone);
    for (const [offset, hour, workspace, title] of [[0, '09:00', 'crm', 'Site visit with Harbour Lofts'], [0, '13:30', 'support', 'Warranty review'], [1, '11:00', 'finance', 'Quarterly billing check'], [3, '15:00', 'crm', 'Follow-up call']] as const) {
      const day = shiftDate(today, offset);
      const startsAt = localDateTimeToInstant(`${day}T${hour}`, timezone);
      await saveCalendarEvent(db as Db, { organizationId: ctx.organizationId, workspace, title, startsAt, endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString() });
    }
    for (const [name, type, body] of [['site-survey.pdf', 'application/pdf', '%PDF-1.4 survey'], ['price-list.csv', 'text/csv', 'item,price\nservice,120'], ['van-photo.png', 'image/png', PNG]] as const) {
      await uploadDocument(db as Db, { organizationId: ctx.organizationId, file: new File([body], name, { type }), files: supabaseFileStore(db as Db, BUCKET) });
    }

    for (const [width, height] of [[1440, 900], [1024, 800], [768, 1024], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await capture(`w${width}-default`, routes);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await setSidebar(false);
    await capture('w1440-default-collapsed', routes);
    await setSidebar(true);
    for (const density of ['compact', 'comfortable'] as const) {
      await setDensity(density);
      await capture(`w1440-${density}`, routes);
      await page.setViewportSize({ width: 1024, height: 800 });
      await capture(`w1024-${density}`, routes.filter(([, archetype]) => archetype !== 'reading'));
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await setDensity(null);
    // An open support rail narrows the working area without changing the viewport.
    const withRail = routes.filter(([name]) => ['crm', 'crm-contacts', 'work-items', 'support', 'schedule', 'library-files'].includes(name));
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

/**
 * Administration needs Platform staff inside GildOps' operating organization, which the disposable
 * business is not. For this capture only, the fixture owner is made staff and the business is named
 * the operating organization, through the database as the deployment's own bootstrap would; both are
 * reverted before the run ends, and the access token is issued fresh so it carries the staff role.
 */
test('capture: Administration composition', async ({ browser, baseURL }) => {
  test.setTimeout(900_000);
  mkdirSync(out, { recursive: true });
  const { ctx, org } = fixture();
  const connection = process.env.SUPABASE_DB_URL!;
  if (!['localhost', '127.0.0.1'].includes(new URL(connection).hostname)) throw new Error('Disposable local stacks only.');
  const pg = new Client({ connectionString: connection });
  await pg.connect();
  const results: Record<string, unknown>[] = [];
  const user = await pg.query<{ id: string }>('select id from auth.users where email = $1', [ctx.ownerEmail]);
  const userId = user.rows[0].id;
  const previous = await pg.query<{ operating_organization_id: string | null }>('select operating_organization_id from platform_settings');
  try {
    await pg.query('insert into platform_staff (user_id, name) values ($1, $2) on conflict (user_id) do nothing', [userId, 'Composition capture']);
    await pg.query('update platform_settings set operating_organization_id = $1', [ctx.organizationId]);
    const { context, page } = await signIn(browser, baseURL!, ctx.ownerEmail);
    const capture = capturer(page, ctx.organizationId, results);
    for (const [width, height] of [[1440, 900], [1024, 800], [390, 844]] as const) {
      await page.setViewportSize({ width, height });
      await capture(`w${width}-default`, adminRoutes(org));
    }
    await context.close();
  } finally {
    // Naming the operating organization links every Platform plan to its price book; unlink them so the business can be removed.
    await pg.query('update platform_plans set price_book_item_id = null where price_book_item_id in (select id from price_book_items where organization_id = $1)', [ctx.organizationId]).catch(() => undefined);
    await pg.query('update platform_settings set operating_organization_id = $1', [previous.rows[0]?.operating_organization_id ?? null]).catch(() => undefined);
    await pg.query('delete from platform_staff where user_id = $1', [userId]).catch(() => undefined);
    await pg.end();
    writeFileSync(path.join(out, 'metrics-administration.json'), JSON.stringify({ phase, captured: new Date().toISOString(), results }, null, 2));
  }
});

test('page frames own region spacing, empty headers take no space and nothing overflows', async ({ page, context, baseURL }) => {
  test.setTimeout(3_600_000);
  page.setDefaultTimeout(30_000);
  const { ctx, db, org } = fixture();
  const signed = await db.auth.signInWithPassword({ email: ctx.ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  const userId = signed.data.user!.id;
  const setDensity = async (density: 'compact' | 'comfortable' | null) => {
    const saved = await db.from('account_appearance_preferences').upsert({ user_id: userId, density });
    if (saved.error) throw saved.error;
  };
  const expected = { compact: 12, default: 16, comfortable: 24 } as const;
  const check = async (state: string, paths: readonly string[], density: keyof typeof expected) => {
    for (const relative of paths) {
      const route = `${org}/${relative}`;
      const response = await page.goto(route);
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      const where = `${relative} (${state})`;
      expect.soft(response?.status(), `${where} status`).toBe(200);
      expect.soft(new URL(page.url()).pathname, `${where} rendered at its own address`).toBe(route);
      const metrics = await measure(page);
      expect.soft(metrics.errorPage, `${where} rendered an error page`).toBe(false);
      expect.soft(metrics.title, `${where} has a page heading`).not.toBeNull();
      expect.soft(metrics.framed, `${where} sits in the page frame`).toBe(true);
      expect.soft(metrics.rowGap, `${where} page gap`).toBe(expected[density]);
      expect.soft(metrics.regionMargins, `${where} regions add their own outer margins`).toEqual([]);
      expect.soft(metrics.emptyRegions, `${where} regions with nothing in them still take a gap`).toEqual([]);
      expect.soft(metrics.unevenGaps, `${where} regions not separated by the page gap`).toEqual([]);
      if (metrics.header && metrics.header.visibleDescendants === 0) expect.soft(metrics.header.inFlow, `${where} empty header takes space`).toBe(false);
      expect.soft(metrics.smallTargets, `${where} controls under the 24px target size`).toEqual([]);
      expect.soft(metrics.overflow ? metrics.overflowing : false, `${where} overflows horizontally`).toBe(false);
    }
  };
  try {
    await setDensity(null);
    await context.addCookies([{ name: 'sidebar_state', value: 'true', url: baseURL! }]);
    // Records too: their sub-navigation and sections are regions of the same frame.
    const paths = [...contractPaths, `crm/contacts/${ctx.customerId}`, `work/${ctx.workItemId}`, `assets/${ctx.assetId}`, `locations/${ctx.locationId}`];
    await page.setViewportSize({ width: 1440, height: 900 });
    await check('1440', paths, 'default');
    await page.setViewportSize({ width: 390, height: 844 });
    await check('390', paths, 'default');
    const sample = ['home', 'calendar', 'crm/contacts', 'library/files', 'work', 'settings/general', 'studio/forms', 'support/cases'];
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const density of ['compact', 'comfortable'] as const) {
      await setDensity(density);
      await check(`1440 ${density}`, sample, density);
    }
    await setDensity(null);
    // The calendar's board keeps a usable working height on a laptop screen, with and without a rail.
    for (const view of ['day', 'week', 'month']) {
      await page.goto(`${org}/calendar?view=${view}`);
      await page.locator('[data-slot=calendar-board]').waitFor();
      expect.soft((await measure(page)).boardHeight ?? 0, `calendar ${view} board height`).toBeGreaterThan(520);
    }
    await page.goto(`${org}/schedule`);
    await page.locator('[data-slot=calendar-board]').waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.waitForTimeout(400);
    const railed = await measure(page);
    expect.soft(railed.boardHeight ?? 0, 'schedule board height beside an open rail').toBeGreaterThan(480);
    expect.soft(railed.overflow, 'schedule beside an open rail overflows').toBe(false);
  } finally {
    await setDensity(null).catch(() => undefined);
    await db.from('account_appearance_preferences').delete().eq('user_id', userId);
  }
});
