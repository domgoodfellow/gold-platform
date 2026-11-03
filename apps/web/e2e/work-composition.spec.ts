import './appearance-env';
import { test, expect, type Page, type Locator, type FullConfig } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { recordPlanAssignment } from '../lib/domain/catalogue/organization-plans';
import { chooseOption, selectFieldValue } from './select-field';

const artifact = (file: string) => path.resolve(__dirname, '../../../.artifacts/composition', file);
// The focused config provisions globally; the full acceptance runner provisions this spec's
// own disposable fixture, rather than applying its role mutations to shared demo businesses.
const ownsFixture = !process.env.E2E_FIXTURE_DIR;
const fixtureDirectory = process.env.E2E_FIXTURE_DIR ?? path.resolve(__dirname, '../../../.artifacts/e2e-composition', String(process.pid));
const OWNER_STORAGE_STATE = path.join(fixtureDirectory, '.auth/owner.json');
const COLLEAGUE_STORAGE_STATE = path.join(fixtureDirectory, '.auth/colleague.json');
const loadDemoContext = () => JSON.parse(readFileSync(path.join(fixtureDirectory, '.demo-context.json'), 'utf8')) as { organizationId: string; ownerEmail: string; customerId: string; locationId: string };
test.beforeAll(async ({ baseURL }) => {
  if (!ownsFixture) return;
  process.env.E2E_FIXTURE_DIR = fixtureDirectory;
  const { default: setup } = await import('./isolated-setup');
  await setup({ projects: [{ use: { baseURL } }] } as FullConfig);
});
test.afterAll(async () => {
  if (!ownsFixture) return;
  try { const { default: teardown } = await import('./isolated-teardown'); await teardown(); }
  finally { delete process.env.E2E_FIXTURE_DIR; }
});
const body = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true }).locator('[data-slot="operational-panel-body"]');
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
async function gutters(locator: Locator, expected: number) {
  const geometry = await locator.evaluate(el => {
    const b = el.getBoundingClientRect(), first = el.firstElementChild!.getBoundingClientRect(), last = el.lastElementChild!.getBoundingClientRect();
    const header = el.previousElementSibling!.getBoundingClientRect();
    return { left: first.left-b.left, right: b.right-first.right, top: first.top-b.top, bottom: b.bottom-last.bottom, divider: first.top-header.bottom };
  });
  for (const dimension of Object.values(geometry)) expect(dimension).toBeCloseTo(expected, 0);
  return geometry;
}
async function capture(page: Page, file: string) {
  const style = await page.addStyleTag({ content: '[data-slot="sidebar-wrapper"] { height:auto!important; overflow:visible!important } [data-slot="sidebar-inset"] { overflow:visible!important }' });
  await page.screenshot({ path: artifact(file), fullPage: true, caret: 'hide' });
  await style.evaluate(el => el.parentNode?.removeChild(el));
}

test.describe.configure({ mode: 'serial' });
test.use({ storageState: OWNER_STORAGE_STATE });

test('shared panels have exact rendered inset and edge-to-edge geometry', async ({ page }) => {
  await page.goto('/dev/design-system');
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, space] of [['Compact inset composition', 12], ['Standard inset composition', 16]] as const) {
      await gutters(body(page, name).first(), space);
    }
    const edge = body(page, 'Edge-to-edge composition').first();
    expect(await edge.evaluate(el => { const b=el.getBoundingClientRect(), t=el.querySelector('table')!.getBoundingClientRect();return { left:t.left-b.left,right:b.right-t.right,top:t.top-b.top }; })).toEqual({ left:0,right:0,top:0 });
    await noOverflow(page);
  }
  await body(page, 'Compact inset composition').first().screenshot({ path: artifact('inset-panel.png') });
});

test('Work Dashboard gutters, actions, composition, and both creation entry points agree', async ({ page }) => {
  const base = `/organizations/${loadDemoContext().organizationId}`;
  const measurements: unknown[] = [];
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/field`);
    // The W1 Dashboard: an overview, then panels that each add something; the panels that only
    // restated the overview (Work status, Insights) and the hand-built tables are gone.
    await expect(page.getByRole('region', { name: 'Work overview', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Manage Work', exact: true })).toHaveCount(0);
    for (const retired of ['Insights', 'Work status', 'Scheduling performance', 'Dispatch overview']) await expect(page.getByRole('heading', { name: retired, exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').locator('table')).toHaveCount(0);
    // Compact panels own 12px gutters on every side.
    const inset = await gutters(body(page, 'Dispatch capacity'), 12);
    await gutters(body(page, 'Upcoming'), 12);
    // The volume chart is the shared chart, not a hand-built meter list.
    await expect(page.locator('[data-slot="chart"]').filter({ has: page.getByRole('heading', { name: 'Scheduled work', exact: true }) })).toBeVisible();
    await expect(page.getByRole('main').locator('meter')).toHaveCount(0);
    const controls = page.locator('[data-slot="workspace-intro"]');
    const rects = (await controls.locator('a[data-slot="button"],button[data-slot="button"],button[data-slot="dropdown-menu-trigger"],input[type="date"]').evaluateAll(elements => elements.map(el => { const r=el.getBoundingClientRect();return { label:el.getAttribute('aria-label')??el.textContent?.trim(),height:r.height,width:r.width,top:r.top,bottom:r.bottom }; }))).filter(rect => rect.width > 0);
    // Date, Configure, Dispatch and New work at least; Apply joins them where there is room.
    expect(rects.length, JSON.stringify({ width, rects })).toBeGreaterThanOrEqual(4);
    for (const rect of rects) expect(rect.height, JSON.stringify({ width, rects })).toBe(28);
    for (const rect of rects) { const row=rects.filter(r=>Math.abs(r.top-rect.top)<10); expect(new Set(row.map(r=>r.top)).size).toBe(1); }
    measurements.push({ width, inset, controls:rects });
    await noOverflow(page);
    await capture(page, `after-home-${width}.png`);
  }
  const destinations: string[] = [], forms: unknown[] = [];
  for (const source of ['field', 'work']) {
    await page.goto(`${base}/${source}`);
    const action=page.getByRole('link', { name:'New work',exact:true });
    expect((await action.boundingBox())!.height).toBe(28);
    await action.click();
    await expect(page).toHaveURL(/\/work\/new(?:\?type=.+)?$/);
    await expect(page.getByRole('form', { name:'Create work' })).toBeVisible();
    destinations.push(new URL(page.url()).pathname);
    forms.push(await page.getByRole('form', { name:'Create work' }).locator('input,select,textarea').evaluateAll(els=>els.map(el=>({name:el.getAttribute('name'),required:el.hasAttribute('required'),type:el.getAttribute('type'),options:el instanceof HTMLSelectElement?[...el.options].map(o=>o.value):undefined}))));
    await noOverflow(page);
    await capture(page, `after-new-from-${source}.png`);
  }
  expect(destinations[0]).toEqual(destinations[1]); expect(forms[0]).toEqual(forms[1]);
  await page.goto(`${base}/work?create=1`);
  await expect(page).toHaveURL(`${base}/work/new`);
  writeFileSync(artifact('geometry.json'),JSON.stringify(measurements,null,2));
});

test('creation prerequisites, setup return, unsaved edits, failed and successful submissions', async ({ page }) => {
  const ctx=loadDemoContext(), organizationId=ctx.organizationId, base=`/organizations/${organizationId}`;
  const db=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await db.auth.signInWithPassword({email:ctx.ownerEmail,password:DEMO_PASSWORD}); if(login.error)throw login.error;
  // A second run-owned business supplies the no-types and all-unconfigured states, without resetting any development business.
  const manifestPath=path.join(process.env.E2E_FIXTURE_DIR!,'fixtures.json');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const pg=new Client(process.env.SUPABASE_DB_URL);await pg.connect();
  let emptyId: string;
  try {
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)',[login.data.user!.id,'Composition fixture provisioner']);
    emptyId=await provisionOrganization(db,{ownerEmail:ctx.ownerEmail,name:'Composition empty fixture',displayName:'Owner',currency:'CAD',timezone:'America/Toronto'});
    manifest.organizationIds.push(emptyId);writeFileSync(manifestPath,JSON.stringify(manifest));
    const plan=await pg.query('select id from platform_plans where key=$1',[manifest.planKeys[0]]);
    await recordPlanAssignment(db,{organizationId:emptyId,planId:plan.rows[0].id,periodStart:'2020-01-01',periodEnd:'9999-12-31'});
  } finally { await pg.query('delete from platform_staff where user_id=$1',[login.data.user!.id]);await pg.end(); }
  await page.goto(`/organizations/${emptyId}/work/new`);
  await expect(page.getByText('No work types yet',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create work',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Create work type',exact:true}).click();
  const newType=page.getByRole('dialog',{name:'New work type',exact:true});
  await newType.getByRole('textbox',{name:'Name',exact:true}).fill('Unconfigured visit');
  await newType.getByRole('radio',{name:/^Scheduled/}).check();
  await newType.getByRole('button',{name:'Create type',exact:true}).click();
  await expect(page).toHaveURL(/returnTo=create&type=.+&tab=workflow$/);
  const createdType=await db.from('work_item_types').select('id').eq('organization_id',emptyId).eq('name','Unconfigured visit').single();
  if(createdType.error)throw createdType.error;
  const incomplete=createdType.data.id;
  await page.goto(`/organizations/${emptyId}/work/new?type=${incomplete}`);
  await expect(page.getByText('Unconfigured visit needs a starting stage',{exact:true}).and(page.locator(':visible'))).toBeVisible();
  await expect(page.getByLabel('Job title',{exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'Configure stages',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`type=${incomplete}`));
  await expect(page.getByRole('tab',{name:'Workflow',exact:true})).toHaveAttribute('data-state','active');
  await page.getByLabel('Status name',{exact:true}).fill('Ready');
  await page.getByRole('button',{name:'Add status',exact:true}).click();
  await expect(page.getByLabel('Status name',{exact:true})).toHaveValue('');
  await page.getByRole('link',{name:'New work',exact:true}).click();
  await expect(selectFieldValue(page.getByLabel('Work type',{exact:true}))).toHaveValue(incomplete);
  await expect(page.getByLabel('Starting stage',{exact:true})).toBeVisible();
  const missing=await createWorkItemType(db,{organizationId,name:'Needs setup',schedulable:false});
  await page.goto(`${base}/work?create=1&type=${missing}`);
  await expect(page).toHaveURL(`${base}/work/new?type=${missing}`);
  await expect(page.getByText('Needs setup needs a starting stage',{exact:true})).toBeVisible();
  const ready=(await db.from('work_item_statuses').select('type_id,id').eq('organization_id',organizationId).limit(1).single()).data!;
  await chooseOption(page.getByLabel('Work type',{exact:true}), ready.type_id);
  await expect(page.getByLabel('Starting stage',{exact:true})).toBeVisible();
  const title=page.getByLabel('Job title',{exact:true});
  await title.fill('Preserved unsaved title');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('link',{name:'Cancel',exact:true}).click();
  await expect(title).toHaveValue('Preserved unsaved title');
  page.once('dialog',dialog=>dialog.dismiss());
  await chooseOption(page.getByLabel('Work type',{exact:true}), missing);
  await expect(title).toHaveValue('Preserved unsaved title');
  // Native required validation accepts whitespace; the real domain action refuses it and must preserve every input.
  await title.fill('   ');
  await chooseOption(page.getByLabel('Customer',{exact:true}), ctx.customerId);
  await chooseOption(page.getByLabel('Location',{exact:true}), ctx.locationId);
  const resource=page.getByRole('checkbox').first();await resource.check();
  await page.getByRole('button',{name:'Create work',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(title).toHaveValue('   ');
  await expect(selectFieldValue(page.getByLabel('Customer',{exact:true}))).toHaveValue(ctx.customerId);
  await expect(selectFieldValue(page.getByLabel('Location',{exact:true}))).toHaveValue(ctx.locationId);
  await expect(resource).toBeChecked();
  await title.fill('Composition created work');
  await page.getByRole('button',{name:'Create work',exact:true}).click();
  await expect(page).toHaveURL(`${base}/work?type=${ready.type_id}`);
  await expect(page.getByRole('link',{name:'Composition created work',exact:true})).toBeVisible();
  const saved=await db.from('work_items').select('customer_id,location_id,type_id').eq('organization_id',organizationId).eq('title','Composition created work').single();
  expect(saved.error).toBeNull();expect(saved.data).toEqual({customer_id:ctx.customerId,location_id:ctx.locationId,type_id:ready.type_id});
  await createWorkItemStatus(db,{organizationId,typeId:missing,name:'Ready'});
});

test('create-only and non-creating members receive the correct page and actions', async ({ browser }) => {
  const {organizationId}=loadDemoContext(), base=`/organizations/${organizationId}`;
  const context=await browser.newContext({storageState:COLLEAGUE_STORAGE_STATE});const page=await context.newPage();
  const pg=new Client(process.env.SUPABASE_DB_URL);await pg.connect();
  try {
    const manifest=JSON.parse(readFileSync(path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json'), 'utf8'));
    const member=await pg.query('select id,role_id from memberships where organization_id=$1 and user_id <> $2',[organizationId,manifest.userIds[0]]);
    expect(member.rows.length).toBe(1);
    const roleId=member.rows[0].role_id;
    await pg.query('update roles set capabilities=$1 where id=$2', [['work_item.create'],roleId]);
    const owner=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    const login=await owner.auth.signInWithPassword({email:loadDemoContext().ownerEmail,password:DEMO_PASSWORD});
    if(login.error)throw login.error;
    const unconfigured=await createWorkItemType(owner,{organizationId,name:'Member setup type',schedulable:false});
    await page.goto(`${base}/work/new?type=${unconfigured}`);
    await expect(page.getByText(/An administrator must configure the type/)).toBeVisible();
    await expect(page.getByRole('link',{name:'Configure stages',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Create work',exact:true})).toHaveCount(0);
    const ready=await pg.query('select type_id from work_item_statuses where organization_id=$1 limit 1',[organizationId]);
    await chooseOption(page.getByLabel('Work type',{exact:true}), ready.rows[0].type_id);
    await expect(page.getByRole('form',{name:'Create work'})).toBeVisible();
    await pg.query('update roles set capabilities=$1 where id=$2',[[],roleId]);
    for(const source of ['field','work']) { await page.goto(`${base}/${source}`);await expect(page.getByRole('link',{name:'New work',exact:true})).toHaveCount(0); }
    await page.goto(`${base}/work/new`);
    await expect(page.getByRole('form',{name:'Create work'})).toHaveCount(0);
  } finally { await pg.end();await context.close(); }
});

test('workspace glyphs align with child rows across five workspaces', async ({ page }) => {
  const base=`/organizations/${loadDemoContext().organizationId}`;
  const comparisons: unknown[]=[];
  await page.setViewportSize({width:1440,height:1000});
  for(const [route,label,child] of [['sales','CRM','Customers'],['field','Work','Work items'],['comms','Communications','Dialer'],['support','Support','Cases'],['studio','Studio','Forms']]) {
    await page.goto(`${base}/${route}`);
    const nav=page.getByRole('navigation',{name:'This business'});
    const heading=nav.getByRole('link',{name:`${label} home`,exact:true});
    const glyph=await heading.locator(':scope > svg').boundingBox();
    const row=await nav.getByRole('link',{name:child,exact:true}).locator(':scope > svg').boundingBox();
    expect(glyph).not.toBeNull();expect(row).not.toBeNull();
    expect(glyph!.width).toBe(row!.width);expect(glyph!.height).toBe(row!.height);expect(glyph!.x).toBe(row!.x);
    await expect(heading).toHaveAttribute('aria-current','page');
    comparisons.push({workspace:label,heading:glyph,child:row});
    await nav.screenshot({path:artifact(`sidebar-${route}.png`)});
  }
  writeFileSync(artifact('sidebar-geometry.json'),JSON.stringify(comparisons,null,2));
});
