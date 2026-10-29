import path from 'node:path';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { Client } from 'pg';
import { provisionFinanceBusiness, signInOwner } from './finance-fixtures';
import { OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { guardedShot } from './visual-guard';
import { loadHome } from '../lib/application/home/load';
import { getOrganization } from '../lib/domain/tenancy/organizations';
import { homePresentation } from '../lib/application/home/presentation';
import { workOperations } from '../lib/application/work/operations';
import { seedH1 } from '../tests/support/home-h1-fixture';
import { recordPlanAssignment } from '../lib/domain/catalogue/organization-plans';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { createRole } from '../lib/domain/tenancy/roles';
import { changeTaskStatus } from '../lib/domain/tasks/tasks';
import { addMember } from '../lib/domain/tenancy/members';
import type { Db } from '../lib/db/types';

const PHASE = process.env.H1_PHASE === 'before' ? 'before' : 'after';
const OUT = path.join(__dirname, '../../../.artifacts/home-h1', PHASE);
test.use({ storageState: OWNER_STORAGE_STATE });
test('Home H1 cross-workspace reconciliation and responsive states', async ({ page, browser }) => {
  test.setTimeout(600_000); page.setDefaultTimeout(15_000);
  const errors: string[] = []; page.on('pageerror',error=>errors.push(error.message));
  const owner = await signInOwner(), db = owner.db as unknown as Db;
  const pg = new Client(process.env.SUPABASE_DB_URL!); await pg.connect();
  const manifest = JSON.parse(readFileSync(path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json'), 'utf8')) as { planKeys: string[]; userIds: string[] };
  const planId = (await pg.query('select id from platform_plans where key=$1', [manifest.planKeys[0]])).rows[0].id;
  const fixtures: Record<string, Awaited<ReturnType<typeof seedH1>>> = {};
  const capture = async (target: Page, name: string, organizationId: string, failure = false) => {
    for (const width of [390, 768, 1024, 1440, 2000]) {
      await target.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const url = `/organizations/${organizationId}/home`;
      await target.goto(url);
      await expect(target.getByRole('main')).toContainText('Needs attention');
      if (PHASE === 'after' && name === 'reduced-role') { await expect(target.getByRole('main')).not.toContainText('Payments recorded'); await expect(target.getByRole('main')).not.toContainText('Outstanding invoices'); }
      if (failure) await expect(target.getByRole('main').getByText('Some sources are temporarily unavailable', { exact: true })).toBeVisible();
      const main = target.getByRole('main');
      expect(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      // Expand only the scroll frame for the artifact, after checking actual viewport geometry.
      const style = await target.addStyleTag({ content: '[data-slot="sidebar-wrapper"]{height:auto!important;overflow:visible!important}[data-slot="sidebar-inset"]{overflow:visible!important}' });
      await guardedShot(target, { url, content: main }, { path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
      await style.evaluate(el => el.parentNode?.removeChild(el));
    }
  };
  let original: string | undefined;
  try {
    for (const kind of ['empty', 'crm', 'work', 'finance', 'mixed'] as const) {
      const id = await provisionFinanceBusiness(owner, `H1 ${kind} ${Date.now()}`);
      await pg.query('insert into platform_staff(user_id,name) values($1,$2) on conflict do nothing', [owner.userId, 'H1 disposable provisioning']);
      try { await recordPlanAssignment(db, { organizationId: id, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' }); }
      finally { await pg.query('delete from platform_staff where user_id=$1', [owner.userId]); }
      if (!['mixed', 'finance'].includes(kind)) await setModuleEnabled(db, { organizationId: id, key: 'billing', enabled: false });
      fixtures[kind] = await seedH1(db, id, kind);
      await capture(page, kind, id);
    }
    const mixed = fixtures.mixed.organizationId;
    const colleague = (await pg.query('select email from auth.users where id=$1', [manifest.userIds[1]])).rows[0].email;
    const roleId = await createRole(db, { organizationId: mixed, name: 'H1 reader', capabilities: [] });
    await addMember(db, { organizationId: mixed, email: colleague, roleId: roleId });
    const reduced = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    try { await capture(await reduced.newPage(), 'reduced-role', mixed); } finally { await reduced.close(); }
    // Real source failure in the disposable database, scoped to this one synthetic organization.
    original = (await pg.query("select pg_get_functiondef('public.finance_dashboard_summary(uuid,date,date)'::regprocedure) as definition")).rows[0].definition;
    await pg.query(original!.replace(/\bbegin\b/i, `begin if p_organization_id = '${mixed}'::uuid then raise exception 'H1 controlled Finance source failure'; end if;`));
    await capture(page, 'partial-source', mixed, true);
    await pg.query(original!); original = undefined;
    if (PHASE === 'before') return;
    await page.setViewportSize({ width: 1440, height: 1000 });
    const home = `/organizations/${mixed}/home`;
    const main = () => page.getByRole('main');
    const attention = () => main().getByRole('region', { name: 'Needs attention', exact: true });
    const obligations = () => main().getByRole('region', { name: 'Today and upcoming', exact: true });
    const data = await loadHome(db, (await getOrganization(db,mixed))!);
    const canonical = await workOperations(db,mixed,fixtures.mixed.date,'America/Toronto');
    const presented = homePresentation(data);
    const keys = [...presented.attention,...presented.mine,...presented.today,...presented.upcoming].map(row=>row.key);
    expect(new Set(keys).size).toBe(keys.length);
    await page.goto(home);
    const overview = main().getByRole('region', { name: 'Business overview' });
    await expect(overview).toContainText('Scheduled today');
    await expect(overview).toContainText(String(canonical.todayCount));
    await expect(attention()).toContainText(`${canonical.conflicts.total} Availability conflicts today`);
    await expect(attention()).toContainText('Late-day emergency inspection');
    await attention().getByRole('link', { name: /Availability conflicts today/ }).click();
    await expect(page).toHaveURL(/work\/dispatch.*assignment=conflict/);
    await expect(main().getByRole('region',{name:'Work queue',exact:true})).toContainText('Late-day emergency inspection');
    await page.goto(home);
    await attention().getByRole('link',{name:'Overdue',exact:true}).click();
    await expect(page).toHaveURL(/attention=overdue/);
    await expect(attention()).not.toContainText('Late-day emergency inspection');
    await attention().getByRole('link',{name:'Mine',exact:true}).click();
    await expect(page).toHaveURL(/scope=mine/);
    await expect(overview).toContainText(String(canonical.todayCount));
    await attention().getByRole('link',{name:'All',exact:true}).click();
    await expect(page).toHaveURL(/scope=organization/);
    await obligations().getByRole('link',{name:'Upcoming',exact:true}).click();
    await expect(page).toHaveURL(/schedule=upcoming/);
    await expect(obligations()).toContainText('Seventh-day follow-up');
    await expect(obligations()).not.toContainText('Eighth-day follow-up');
    await page.reload();
    await expect(obligations().getByRole('link',{name:'Upcoming',exact:true})).toHaveAttribute('aria-current','page');
    await obligations().getByRole('link',{name:'Today',exact:true}).click();
    await expect(page).toHaveURL(/schedule=today/);
    await page.goBack();
    await expect(page).toHaveURL(/schedule=upcoming/);
    await expect(obligations()).toContainText('Seventh-day follow-up');
    await page.goForward();
    await expect(page).toHaveURL(/schedule=today/);
    const performance = () => main().getByRole('region',{name:'Business performance',exact:true});
    await performance().getByRole('link',{name:'Last 7 days',exact:true}).click();
    await expect(page).toHaveURL(/when=week/);
    await expect(overview).toContainText(String(canonical.todayCount));
    await expect(performance()).toContainText('CA$15.00');
    await expect(performance().locator('[data-slot="chart"]')).toBeVisible();
    await performance().getByRole('combobox',{name:'Payments recorded presentation'}).selectOption('table');
    await expect(performance().getByRole('table').getByText('-CA$5.00',{exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    await guardedShot(page,{url:/home.*when=week/,content:performance()},{path:path.join(OUT,'performance-week-390.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(home);
    await attention().getByRole('link',{name:'Open Invoice #1',exact:true}).click();
    await expect(page).toHaveURL(/finance\/invoices/);
    expect(new URL(page.url()).searchParams.get('invoice')).toBe(fixtures.mixed.ids.invoice);
    await expect(page.getByRole('dialog',{name:'Invoice #1',exact:true})).toBeVisible();
    await page.goto(home);
    await main().getByRole('button',{name:'Quick actions',exact:true}).click();
    await page.getByRole('menuitem',{name:'New work',exact:true}).click();
    await expect(page).toHaveURL(/work\/new/);
    await expect(main().getByRole('form',{name:'Create work',exact:true})).toBeVisible();
    await page.goto(home);
    await main().getByRole('button',{name:'Ask or find something...',exact:true}).click();
    const palette = page.getByRole('dialog',{name:'Search and commands'});
    await expect(palette).toBeVisible();
    await palette.getByRole('button',{name:'Which Work is at risk?',exact:true}).click();
    await expect(page.getByRole('complementary',{name:'Agent',exact:true})).toBeVisible();
    await expect(page.getByLabel('Message to the Agent',{exact:true})).toHaveValue('Which Work is at risk?');
    for(const width of [390,768,1024,1440,2000]) {
      await page.setViewportSize({width,height:1000});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    }
    await page.getByRole('button',{name:'Close Agent',exact:true}).click();
    await page.setViewportSize({width:1440,height:1000});
    await main().getByRole('button',{name:'Customize',exact:true}).click();
    await page.getByRole('checkbox',{name:'Recent activity',exact:true}).uncheck();
    await page.keyboard.press('Escape');
    await expect(main().getByRole('region',{name:'Recent activity',exact:true})).toHaveCount(0);
    await page.reload();
    await expect(main().getByRole('region',{name:'Recent activity',exact:true})).toHaveCount(0);
    await main().getByRole('button',{name:'Customize',exact:true}).click();
    await page.getByRole('checkbox',{name:'Recent activity',exact:true}).check();
    await page.keyboard.press('Escape');
    await expect(main().getByRole('region',{name:'Recent activity',exact:true})).toBeVisible();
    await page.evaluate(()=>{ Storage.prototype.setItem=()=>{throw new DOMException('Storage disabled','SecurityError');}; });
    await main().getByRole('button',{name:'Customize',exact:true}).click();
    await page.getByRole('checkbox',{name:'Recent activity',exact:true}).click();
    await expect(main().getByRole('alert').filter({hasText:'could not be saved'})).toBeVisible();
    await expect(page.getByRole('checkbox',{name:'Recent activity',exact:true})).toBeChecked();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(main().getByRole('region',{name:'Recent activity',exact:true})).toBeVisible();
    await changeTaskStatus(db,{organizationId:mixed,id:fixtures.mixed.ids.overdue,status:'completed'});
    await page.route(`**/organizations/${mixed}/home*`,async route=>{ if(route.request().headers()['rsc']) await new Promise(resolve=>setTimeout(resolve,800)); await route.continue(); });
    const refresh = main().getByRole('button',{name:'Refresh Home',exact:true});
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(main().locator('[aria-busy="true"]')).toBeVisible();
    await expect(overview).toContainText(String(canonical.todayCount));
    await expect(refresh).toBeEnabled();
    await expect(attention()).not.toContainText('Confirm the revised maintenance proposal');
    await page.unroute(`**/organizations/${mixed}/home*`);
    expect(errors).toEqual([]);

  } finally { if (original) await pg.query(original); await pg.end(); }
});
