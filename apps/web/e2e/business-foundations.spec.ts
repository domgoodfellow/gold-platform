import './appearance-env';
import { platformUrl } from './helpers';
import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import type {Browser} from '@playwright/test';
import {foundBusiness} from '../tests/support/founding';
import {setModuleEnabled} from '../lib/domain/tenancy/modules';
import {launchOrganization} from '../lib/domain/tenancy/lifecycle';
import {bootstrapOperatingOrganization} from '../lib/domain/platform/operating-organization';
import { recordFixtureTerm } from '../tests/support/plans';

async function fixture(browser:Browser,platform=false){
 const url=process.env.SUPABASE_URL!;if(!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Local fixtures only');
 const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
 const email=`foundations-${randomUUID()}@example.test`;const password=randomUUID();
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
 const pg=new Client(process.env.SUPABASE_DB_URL);await pg.connect();let operating:string|undefined;
 try{if(platform){await pg.query('insert into public.platform_staff(user_id,name) values($1,$2)',[created.data.user.id,'Browser fixture']);operating=(await pg.query('select operating_organization_id as id from public.platform_settings limit 1')).rows[0]?.id;
   // Administration is part of GildOps' own organization, so its staff are members there too.
   if(operating)await pg.query('insert into public.memberships(organization_id,user_id,role_id,created_by) select $1,$2,r.id,$2 from public.roles r where r.organization_id=$1 order by r.created_at,r.id limit 1',[operating,created.data.user.id]);}}finally{await pg.end();}
 const context=await browser.newContext();const cookies:{name:string;value:string;domain:string;path:string}[]=[];
 const db=createServerClient(url,process.env.SUPABASE_ANON_KEY!,{cookies:{getAll:()=>[],setAll:entries=>{for(const entry of entries)cookies.push({name:entry.name,value:entry.value,domain:new URL(process.env.E2E_BASE_URL??'http://localhost:3000').hostname,path:'/'});}}});
 const login=await db.auth.signInWithPassword({email,password});if(login.error)throw login.error;
 await context.addCookies(cookies);
 if(platform){const wasConfigured=!!operating;operating??=await foundBusiness({ownerEmail:email,name:'Platform browser fixture '+randomUUID().slice(0,8),currency:'EUR'});await bootstrapOperatingOrganization(db,{organizationId:operating});const cleanup=async()=>{const connection=new Client(process.env.SUPABASE_DB_URL);await connection.connect();try{if(wasConfigured)await connection.query('delete from public.memberships where organization_id=$1 and user_id=$2',[operating,created.data.user.id]);else await connection.query('update public.platform_settings set operating_organization_id=null where operating_organization_id=$1',[operating]);}finally{await connection.end();}};return {context,db,organizationId:operating,cleanup};}
 const organizationId=await foundBusiness({ownerEmail:email,name:'Browser foundation '+randomUUID().slice(0,8),currency:'EUR'});
 await launchOrganization(db,{organizationId});
 const now=Date.now();await recordFixtureTerm({organizationId,productKey:'module:reception',periodStart:new Date(now-60000).toISOString(),periodEnd:new Date(now+86400000).toISOString(),priceMinor:0,currency:'EUR'});
 await setModuleEnabled(db,{organizationId,key:'reception',enabled:true});
 return {context,db,organizationId,cleanup:async()=>{}};
}

test('business vocabulary stays within contextual workspaces across responsive widths',async({browser})=>{
  test.setTimeout(120_000);
  const {context,db,organizationId}=await fixture(browser);
  const {data:before,error}=await db.from('organization_business_profiles').select('*').eq('organization_id',organizationId).maybeSingle();if(error)throw error;
  const page=await context.newPage();
  try{
    await page.goto(`/organizations/${organizationId}/settings/general`);
    await page.getByRole('textbox',{name:'Customer singular',exact:true}).fill('Patient');
    await page.getByRole('textbox',{name:'Customer plural',exact:true}).fill('Patients');
    await page.getByRole('button',{name:'Save business words and navigation',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Business profile saved.'})).toBeVisible();
    await page.goto(`/organizations/${organizationId}/crm/contacts`);
    await expect(page.getByRole('heading',{name:'Patients',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'New patient',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'No patients yet',exact:true})).toBeVisible();
    const nav=()=>page.getByRole('navigation',{name:'This business'});
    await expect(nav().getByRole('link',{name:'Patients',exact:true})).toBeVisible();
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:900});
      await page.goto(`/organizations/${organizationId}/calls`);
      if(width<768)await page.getByRole('button',{name:'Toggle Sidebar'}).click();
      await expect(nav().getByRole('link',{name:'Dialer',exact:true})).toBeVisible();
      await expect(nav().getByRole('link',{name:'Patients',exact:true})).toHaveCount(0);
      await expect(nav().getByRole('link',{name:'Home',exact:true})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`.artifacts/business-foundations-${width}.png`,fullPage:true});
    }
  }finally{
    const {data:current}=await db.from('organization_business_profiles').select('revision').eq('organization_id',organizationId).single();
    if(current){const restored=await db.rpc('save_business_profile',{p_organization_id:organizationId,p_revision:current.revision,p_nouns:before?.nouns??{},p_navigation:before?.navigation??[],p_labels:before?.labels??{}});if(restored.error)throw restored.error;}
    await context.close();
  }
});

test('Administration renders in the organization shell and old Platform URLs are gone',async({browser})=>{
  test.setTimeout(90_000);
  const {context,organizationId:goldOrganizationId,cleanup}=await fixture(browser,true);const page=await context.newPage();
  try{
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:900});await page.goto(platformUrl('providers'));
      await expect(page.getByText('GildOps Platform',{exact:true})).toHaveCount(0);
      if(width<768)await page.getByRole('button',{name:/^(Toggle Sidebar|Menu)$/}).click();
      await expect(page.getByRole('navigation',{name:'This business'}).filter({visible:true}).getByRole('link',{name:'Vendors',exact:true})).toHaveAttribute('aria-current','page');
      if(width<768)await page.keyboard.press('Escape');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`.artifacts/platform-foundations-${width}.png`,fullPage:true});
    }
    await page.goto(platformUrl('ai-runtime'));await expect(page.getByRole('heading',{name:'Recent voice sessions'})).toBeVisible();
    for(const retired of ['/platform/providers',`/organizations/${goldOrganizationId}/platform/providers`]){await page.goto(retired);await expect(page.getByRole('heading',{name:/^This page does not exist/})).toBeVisible();await expect(page).toHaveURL(retired);}
  }finally{await context.close();await cleanup();}
});
