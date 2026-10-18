import './appearance-env';
import {test,expect} from '@playwright/test';
import {createClient} from '@supabase/supabase-js';
import {createServerClient} from '@supabase/ssr';
import {randomUUID} from 'node:crypto';
import {Client} from 'pg';
import type {Browser} from '@playwright/test';
import {foundBusiness,asPlatformStaff} from '../tests/support/founding';
import {setModuleEnabled} from '../lib/domain/tenancy/modules';
import {launchOrganization} from '../lib/domain/tenancy/lifecycle';
import {recordCommercialTerm} from '../lib/domain/commercial/terms';
import {bootstrapOperatingOrganization} from '../lib/domain/platform/operating-organization';

async function fixture(browser:Browser,platform=false){
 const url=process.env.SUPABASE_URL!;if(!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Local fixtures only');
 const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
 const email=`foundations-${randomUUID()}@example.test`;const password=randomUUID();
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
 const pg=new Client(process.env.SUPABASE_DB_URL);await pg.connect();let operating:string|undefined;
 try{if(platform){await pg.query('insert into public.platform_staff(user_id,name) values($1,$2)',[created.data.user.id,'Browser fixture']);operating=(await pg.query('select operating_organization_id as id from public.platform_settings limit 1')).rows[0]?.id;}}finally{await pg.end();}
 const context=await browser.newContext();const cookies:{name:string;value:string;domain:string;path:string}[]=[];
 const db=createServerClient(url,process.env.SUPABASE_ANON_KEY!,{cookies:{getAll:()=>[],setAll:entries=>{for(const entry of entries)cookies.push({name:entry.name,value:entry.value,domain:'127.0.0.1',path:'/'});}}});
 const login=await db.auth.signInWithPassword({email,password});if(login.error)throw login.error;
 await context.addCookies(cookies);
 if(platform){const wasConfigured=!!operating;operating??=await foundBusiness({ownerEmail:email,name:'Platform browser fixture '+randomUUID().slice(0,8),currency:'EUR'});await bootstrapOperatingOrganization(db,{organizationId:operating});const cleanup=async()=>{if(!wasConfigured){const connection=new Client(process.env.SUPABASE_DB_URL);await connection.connect();try{await connection.query('update public.platform_settings set operating_organization_id=null where operating_organization_id=$1',[operating]);}finally{await connection.end();}}};return {context,db,organizationId:operating,cleanup};}
 const organizationId=await foundBusiness({ownerEmail:email,name:'Browser foundation '+randomUUID().slice(0,8),currency:'EUR'});
 await launchOrganization(db,{organizationId});
 const staff=await asPlatformStaff();const now=Date.now();await recordCommercialTerm(staff,{organizationId,productKey:'module:reception',periodStart:new Date(now-60000).toISOString(),periodEnd:new Date(now+86400000).toISOString(),priceMinor:0,currency:'EUR'});
 await setModuleEnabled(db,{organizationId,key:'reception',enabled:true});
 return {context,db,organizationId,cleanup:async()=>{}};
}

test('business vocabulary and one sidebar persist across destinations and responsive widths',async({browser})=>{
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
    await page.goto(`/organizations/${organizationId}/customers`);
    await expect(page.getByRole('heading',{name:'Patients',exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'New patient',exact:true})).toBeVisible();
    await expect(page.getByRole('heading',{name:'No patients yet',exact:true})).toBeVisible();
    const nav=()=>page.getByRole('navigation',{name:'This business'});
    await expect(nav().getByRole('link',{name:'Patients',exact:true})).toBeVisible();
    const links=await nav().getByRole('link').evaluateAll(elements=>elements.map(e=>e.getAttribute('href')));
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:900});
      await page.goto(`/organizations/${organizationId}/calls`);
      if(width<768)await page.getByRole('button',{name:'Toggle Sidebar'}).click();
      await expect(nav().getByRole('link',{name:'Patients',exact:true})).toBeVisible();
      expect(await nav().getByRole('link').evaluateAll(elements=>elements.map(e=>e.getAttribute('href')))).toEqual(links);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`.artifacts/business-foundations-${width}.png`,fullPage:true});
    }
  }finally{
    const {data:current}=await db.from('organization_business_profiles').select('revision').eq('organization_id',organizationId).single();
    if(current){const restored=await db.rpc('save_business_profile',{p_organization_id:organizationId,p_revision:current.revision,p_nouns:before?.nouns??{},p_navigation:before?.navigation??[],p_labels:before?.labels??{}});if(restored.error)throw restored.error;}
    await context.close();
  }
});

test('Platform is independently rendered and old organization Platform URLs are gone',async({browser})=>{
  test.setTimeout(90_000);
  const {context,organizationId:goldOrganizationId,cleanup}=await fixture(browser,true);const page=await context.newPage();
  try{
    for(const width of [1440,768,390]){
      await page.setViewportSize({width,height:900});await page.goto('/platform/providers');
      if(width>=768)await expect(page.getByText('GildOps Platform',{exact:true})).toBeVisible();
      if(width<768)await page.getByRole('button',{name:'Toggle Sidebar'}).click();
      await expect(page.getByRole('navigation',{name:'Platform Administration'})).toBeVisible();
      await expect(page.getByRole('button',{name:'Agent',exact:true})).toHaveCount(0);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`.artifacts/platform-foundations-${width}.png`,fullPage:true});
    }
    await page.goto('/platform/ai-runtime');await expect(page.getByRole('heading',{name:'Recent voice sessions'})).toBeVisible();
    await page.goto(`/organizations/${goldOrganizationId}/platform/providers`);await expect(page.getByRole('heading',{name:'This page does not exist'})).toBeVisible();await expect(page).toHaveURL(`/organizations/${goldOrganizationId}/platform/providers`);await expect(page.getByRole('navigation',{name:'Platform Administration'})).toHaveCount(0);
  }finally{await context.close();await cleanup();}
});
