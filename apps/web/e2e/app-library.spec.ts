import {expect,test} from '@playwright/test';
import {loadDemoContext,OWNER_STORAGE_STATE} from './helpers';

test.use({storageState:OWNER_STORAGE_STATE});
test('installed apps stay discoverable with truthful blockers on desktop and mobile',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const base=`/organizations/${loadDemoContext().organizationId}/settings/connections`;
  await page.goto(`${base}?catalog=open&q=stripe`);
  await expect(page.getByRole('heading',{name:'App Library',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Stripe',exact:true})).toBeVisible();
  await expect(page.getByText(/reviewed read operations/)).toBeVisible();
  await expect(page.getByText('Connecting grants data access. Financial writes require separate authorization.')).toBeVisible();
  await page.getByLabel('Search applications').fill('no-such-imported-application');
  await page.getByRole('button',{name:'Search',exact:true}).click();
  await expect(page).toHaveURL(/catalog=open/);
  await expect(page).toHaveURL(/q=no-such-imported-application/);
  await expect(page.getByRole('heading',{name:'Connections',exact:true})).toBeVisible();
  await expect(page.getByText('No application matches these filters.')).toBeVisible();
  await page.goto(`${base}?catalog=open&workspace=finance`);
  await expect(page.getByRole('heading',{name:'Stripe',exact:true})).toBeVisible();
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/app-library-mobile.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'test-results/app-library-desktop.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('the App Library expands inside Connections and keeps its filters in the URL', async ({ page }) => {
  const base = `/organizations/${loadDemoContext().organizationId}/settings/connections`;
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'App Library', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Browse the App Library' }).click();
  await expect(page).toHaveURL(/\/settings\/connections\?catalog=open/);
  await expect(page.getByRole('heading', { name: 'Connections', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'App Library', exact: true })).toBeVisible();
  await page.getByLabel('Search applications').fill('stripe');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/catalog=open/);
  await expect(page).toHaveURL(/q=stripe/);
  await page.reload();
  await expect(page.getByLabel('Search applications')).toHaveValue('stripe');
  await expect(page.getByRole('heading', { name: 'Stripe', exact: true })).toBeVisible();
  await page.goto(`${base}/apps?q=stripe&workspace=finance`);
  await expect(page).toHaveURL(/\/settings\/connections\?.*catalog=open/);
  await expect(page).toHaveURL(/q=stripe/);
  await page.getByRole('link', { name: 'Hide the App Library' }).click();
  await expect(page.getByRole('heading', { name: 'App Library', exact: true })).toHaveCount(0);
});
