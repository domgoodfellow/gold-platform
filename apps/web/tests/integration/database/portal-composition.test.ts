import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { foundBusiness, asPlatformStaff } from '@/tests/support/founding';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { createPlan, setPlanFeatureOverride } from '@/lib/domain/catalogue/plans';
import { submitPortalForm, setPortalForm } from '@/lib/domain/portal/portal-forms';
import { createForm, saveFormDraft, publishFormRevision } from '@/lib/domain/forms/forms';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPortalInvite, exchangePortalLink, revokePortalInvite, listPortalInvites } from '@/lib/domain/portal/portal';
import { createServiceEngagement, attachEngagementDeliverable, listEngagementDeliverables, listDeliverableOptions } from '@/lib/domain/customers/service-engagements';
import { DEFAULT_PORTAL_CONTENT, parsePortalContent } from '@/lib/domain/portal/composition';
import { portalEditorState, savePortalDraft, publishPortalDraft, unpublishPortal, publishedPortalContent, submitPortalDraft, portalModuleAvailability, portalHistoryBefore } from '@/lib/domain/portal/definitions';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const connection = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const client = () => createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
let pg: Client; let operator: SupabaseClient; let foreign: SupabaseClient;
let portal: SupabaseClient; let otherPortal: SupabaseClient; let org: string; let foreignOrg: string;
let customer: string; let otherCustomer: string; let invite: string; let token: string;
const content = { ...structuredClone(DEFAULT_PORTAL_CONTENT), settings: { title: 'Client centre', introduction: 'Welcome back.', layout: 'comfortable' as const } };
const version = async () => (await portalEditorState(operator, org)).definition!.draft_version;

beforeAll(async () => {
  if (!['127.0.0.1','localhost'].includes(new URL(connection).hostname)) throw new Error('Disposable local fixtures only');
  pg = new Client(connection); await pg.connect();
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  async function account(label: string) {
    const email = `${label}-${randomUUID()}@example.test`; const password = `pw-${randomUUID()}`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (made.error) throw made.error;
    const db = client(); const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
    return { db, email };
  }
  const owner = await account('portal-owner'); const outsider = await account('portal-other');
  operator = owner.db; foreign = outsider.db;
  org = await foundBusiness({ ownerEmail: owner.email, name: 'Portal business', currency: 'CAD' });
  await setModuleEnabled(operator, { organizationId: org, key: 'portal', enabled: true });
  foreignOrg = await foundBusiness({ ownerEmail: outsider.email, name: 'Other portal business', currency: 'CAD' });
  customer = await createCustomer(operator, { organizationId: org, name: 'Client one' });
  otherCustomer = await createCustomer(operator, { organizationId: org, name: 'Client two' });
  token = await createPortalInvite(operator, { customerId: customer });
  const second = await createPortalInvite(operator, { customerId: otherCustomer });
  invite = (await listPortalInvites(operator, { organizationId: org, customerId: customer }))[0].id;
  portal = client(); otherPortal = client();
  await exchangePortalLink(portal, { token }); await exchangePortalLink(otherPortal, { token: second });
});
afterAll(async () => { await pg?.end(); });

describe('Studio Portal composition and external identity', () => {
  it('keeps default composition for existing invitations without a definition', async () => {
    expect(await publishedPortalContent(portal)).toEqual(DEFAULT_PORTAL_CONTENT);
    expect((await portalModuleAvailability(portal)).defaultExperience).toBe(true);
    expect(await publishedPortalContent(operator)).toBeNull();
  });
  it('rejects unsupported, duplicate, empty, oversized and malformed composition at the database boundary', async () => {
    for (const value of [null, [], {}, { ...content, modules: [] }, { ...content, modules: ['work','work'] }, { ...content, modules: ['secrets'] }, { ...content, modules: [null] }, { ...content, title: ' ' }, { ...content, introduction: 'x'.repeat(1001) }, { ...content, customerId: customer }]) {
      expect((await operator.rpc('save_portal_draft', { p_organization_id: org, p_expected_version: 0, p_content: value })).error?.code).toBe('22023');
    }
  });
  it('agrees with the typed validator on page/module/navigation scalar and Unicode boundaries', async () => {
    const base=structuredClone(DEFAULT_PORTAL_CONTENT);
    const cases=[
      base,
      {...base,settings:{...base.settings,title:'😀'.repeat(100)}},
      {...base,settings:{...base.settings,title:'😀'.repeat(101)}},
      {...base,settings:{...base.settings,title:'\u00a0'}},
      {...base,settings:{...base.settings,title:'v'}},
      {...base,settings:{...base.settings,title:'\u000b'}},
      {...base,settings:{...base.settings,title:'\ufeff'}},
      {...base,settings:{...base.settings,layout:null}},
      {...base,pages:[{...base.pages[0],id:1}]},
      {...base,pages:[{...base.pages[0],path:1}]},
      {...base,pages:[{...base.pages[0],path:'../secret'}]},
      {...base,navigation:[{pageId:'missing',label:'Missing'}]},
      {...base,pages:[{...base.pages[0],modules:[...base.pages[0].modules,base.pages[0].modules[0]]}]},
      {...base,pages:[{...base.pages[0],modules:[{...base.pages[0].modules[0],config:{...base.pages[0].modules[0].config,limit:1.5}}]}]},
    ];
    for(const value of cases) {
      let valid=true;try{parsePortalContent(value);}catch{valid=false;}
      expect((await pg.query('select app.valid_portal_content($1::jsonb) valid',[JSON.stringify(value)])).rows[0].valid).toBe(valid);
    }
  });
  it('refuses foreign writes, Portal writes and direct table writes', async () => {
    for (const db of [foreign, portal]) {
      expect((await db.rpc('save_portal_draft', { p_organization_id: org, p_expected_version: 0, p_content: content })).error?.code).toBe('42501');
      expect((await db.rpc('publish_portal_draft', { p_organization_id: org, p_expected_version: 0 })).error?.code).toBe('42501');
      expect((await db.rpc('unpublish_portal', { p_organization_id: org, p_expected_version: 0 })).error?.code).toBe('42501');
    }
    const { rows } = await pg.query("select has_table_privilege('authenticated','portal_definitions','INSERT') as insert,has_table_privilege('authenticated','portal_revisions','UPDATE') as update,has_table_privilege('authenticated','portal_revisions','DELETE') as delete");
    expect(rows[0]).toEqual({ insert: false, update: false, delete: false });
  });
  it('saves a private draft without disturbing the legacy Portal and hides draft/history from outsiders', async () => {
    await savePortalDraft(operator, org, 0, content);
    expect(await publishedPortalContent(portal)).toEqual(DEFAULT_PORTAL_CONTENT);
    expect((await portalEditorState(portal, org)).definition).toBeNull();
    expect((await portalEditorState(foreign, org)).definition).toBeNull();
    await savePortalDraft(foreign, foreignOrg, 0, DEFAULT_PORTAL_CONTENT);
    expect((await portalEditorState(operator, foreignOrg)).definition).toBeNull();
  });
  it('rejects stale edits and publication without overwriting the saved draft', async () => {
    await expect(savePortalDraft(operator, org, 0, DEFAULT_PORTAL_CONTENT)).rejects.toThrow('Portal changed');
    await expect(publishPortalDraft(operator, org, 0)).rejects.toThrow('Portal changed');
    expect(parsePortalContent((await portalEditorState(operator, org)).definition!.draft_content)).toEqual(content);
  });
  it('requires current entitlement and review before publication', async () => {
    await expect(publishPortalDraft(operator, org, await version())).rejects.toThrow('entitlement');
    await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:portal','2020-01-01','9999-12-31',1,0,'CAD',$2,'local Portal verification')",[org,(await operator.auth.getUser()).data.user!.id]);
    await expect(publishPortalDraft(operator, org, await version())).rejects.toThrow('review');
  });
  it('publishes an immutable attributed snapshot and treats repeat publication idempotently', async () => {
    await submitPortalDraft(operator, org, await version());
    await publishPortalDraft(operator, org, await version());
    expect(await publishedPortalContent(portal)).toEqual(content);
    const before = await portalEditorState(operator, org);
    expect(before.history).toHaveLength(1);
    expect((await portalModuleAvailability(portal)).defaultExperience).toBe(false);
    expect(before.history[0].published_by).toBe((await operator.auth.getUser()).data.user!.id);
    await publishPortalDraft(operator, org, await version());
    expect((await portalEditorState(operator, org)).history).toHaveLength(1);
    expect((await portalEditorState(portal, org)).history).toEqual([]);
  });
  it('does not publish later edits and permits exactly one concurrent save of a version', async () => {
    const current = await version();
    const results = await Promise.allSettled([
      savePortalDraft(operator, org, current, { ...content, settings: { ...content.settings, title: 'Private draft A' } }),
      savePortalDraft(operator, org, current, { ...content, settings: { ...content.settings, title: 'Private draft B' } }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await publishedPortalContent(portal)).toEqual(content);
    expect((await portalEditorState(operator, org)).history[0].content).toEqual(content);
  });
  it('refuses a stale client Form revision even when its answers fit the current definition', async () => {
    const form=await createForm(operator,{organizationId:org,name:'Revision boundary fixture'});
    await saveFormDraft(operator,{organizationId:org,revisionId:form.revisionId,definition:{title:'Revision boundary',submitLabel:'Send',confirmation:{title:'Received',message:''},fields:[{id:'note',type:'short_text',label:'Note',required:true}]}});
    await publishFormRevision(operator,{organizationId:org,revisionId:form.revisionId});await setPortalForm(operator,{organizationId:org,formId:form.formId,enabled:true});
    expect(await submitPortalForm(portal,{formId:form.formId,revisionId:randomUUID(),answers:{note:'Would fit'}})).toMatchObject({ok:false,stale:true});
    expect((await pg.query('select count(*) n from form_submissions where form_id=$1',[form.formId])).rows[0].n).toBe('0');
    expect(await submitPortalForm(portal,{formId:form.formId,revisionId:form.revisionId,answers:{note:'Current revision'}})).toEqual({ok:true});
  });
  it('unpublishes immediately without reverting to the legacy portal or deleting invitations/history', async () => {
    await expect(unpublishPortal(operator, org, 0)).rejects.toThrow('Portal changed');
    await unpublishPortal(operator, org, await version());
    expect(await publishedPortalContent(portal)).toBeNull();
    expect((await portalEditorState(operator, org)).history).toHaveLength(1);
    expect((await listPortalInvites(operator, { organizationId: org, customerId: customer }))[0].revokedAt).toBeNull();
  });
  it('restores a historical snapshot as a draft, then publishes a new release', async () => {
    const state = await portalEditorState(operator, org);
    await savePortalDraft(operator, org, await version(), parsePortalContent(state.history[0].content));
    expect(await publishedPortalContent(portal)).toBeNull();
    await submitPortalDraft(operator, org, await version());
    await publishPortalDraft(operator, org, await version());
    expect(await publishedPortalContent(portal)).toEqual(content);
    expect((await portalEditorState(operator, org)).history.map(row => row.number)).toEqual([2,1]);
  });
  it('refuses publication and customer reads when the existing Portal activation is disabled', async () => {
    await setModuleEnabled(operator, { organizationId: org, key: 'portal', enabled: false });
    expect(await publishedPortalContent(portal)).toBeNull();
    await expect(publishPortalDraft(operator, org, await version())).rejects.toThrow('Portal entitlement');
    await setModuleEnabled(operator, { organizationId: org, key: 'portal', enabled: true });
    expect(await publishedPortalContent(portal)).toEqual(content);
    expect((await client().rpc('portal_published_composition')).error?.code).toBe('42501');
  });
  it('binds hosted exchange and context to verified Portal or same-organization managed origins', async () => {
    const oldZone = (await pg.query('select platform_public_domain from platform_settings where singleton')).rows[0].platform_public_domain;
    const slug = `portal-${randomUUID().slice(0,8)}`;
    try {
      await pg.query('update platform_settings set platform_public_domain=$1 where singleton',['batch-b.example.test']);
      await pg.query('update organizations set slug=$1 where id=$2',[slug,org]);
      expect((await portal.rpc('portal_context_at_hostname',{p_hostname:`${slug}.batch-b.example.test`})).data?.[0]?.organization_id).toBe(org);
      expect((await portal.rpc('portal_context_at_hostname',{p_hostname:'unknown.batch-b.example.test'})).data).toEqual([]);
      const hosted=client();
      await expect(exchangePortalLink(hosted,{token,hostname:`${slug}.batch-b.example.test`})).resolves.toBe(org);
      await expect(exchangePortalLink(client(),{token,hostname:'unknown.batch-b.example.test'})).rejects.toThrow('not valid');
      const hostname=`portal-${randomUUID()}.example.test`;
      const {data:domain,error}=await operator.rpc('begin_custom_domain_connection',{p_organization_id:org,p_hostname:hostname,p_surface:'portal'});expect(error).toBeNull();
      expect((await portal.rpc('portal_context_at_hostname',{p_hostname:hostname})).data).toEqual([]);
      await pg.query('begin');await pg.query('set local role provider_operator');
      await pg.query("select record_custom_domain_registration($1,$2,'satisfied','[]'::jsonb,null,null)",[org,domain]);
      await pg.query("select set_custom_domain_verification($1,$2,'verified','satisfied','issued',null,null,null)",[org,domain]);await pg.query('commit');
      expect((await portal.rpc('portal_context_at_hostname',{p_hostname:hostname})).data?.[0]?.organization_id).toBe(org);
      await expect(exchangePortalLink(client(),{token,hostname})).resolves.toBe(org);
      await pg.query('update organization_domains set released_at=now(),released_by=created_by where id=$1',[domain]);
      expect((await portal.rpc('portal_context_at_hostname',{p_hostname:hostname})).data).toEqual([]);
      for(const fixture of [{db:operator,org,surface:'website'},{db:foreign,org:foreignOrg,surface:'portal'}]) {
        const wrongHost=`wrong-${randomUUID()}.example.test`;
        const claimed=await fixture.db.rpc('begin_custom_domain_connection',{p_organization_id:fixture.org,p_hostname:wrongHost,p_surface:fixture.surface});expect(claimed.error).toBeNull();
        await pg.query('begin');await pg.query('set local role provider_operator');
        await pg.query("select record_custom_domain_registration($1,$2,'satisfied','[]'::jsonb,null,null)",[fixture.org,claimed.data]);
        await pg.query("select set_custom_domain_verification($1,$2,'verified','satisfied','issued',null,null,null)",[fixture.org,claimed.data]);await pg.query('commit');
        expect((await portal.rpc('portal_context_at_hostname',{p_hostname:wrongHost})).data).toEqual([]);
        await expect(exchangePortalLink(client(),{token,hostname:wrongHost})).rejects.toThrow('not valid');
      }
    } finally {await pg.query('rollback');await pg.query('update platform_settings set platform_public_domain=$1 where singleton',[oldZone]);}
  });
  it('refuses direct Form/payment commands when published exposure is removed', async () => {
    const hidden=structuredClone(content);hidden.pages[0].modules=hidden.pages[0].modules.filter(module=>module.kind==='work');
    await savePortalDraft(operator,org,await version(),hidden);await submitPortalDraft(operator,org,await version());await publishPortalDraft(operator,org,await version());
    expect((await portal.rpc('portal_forms_available')).data).toEqual([]);
    expect((await portal.rpc('submit_portal_form',{p_form_id:randomUUID(),p_revision_id:randomUUID(),p_answers:{}})).error?.code).toBe('42501');
    expect((await portal.rpc('begin_external_card_payment',{p_invoice_id:randomUUID(),p_provider:'stripe'})).error?.code).toBe('42501');
  });
  it('does not expose modules on excluded pages or payments disabled in configuration', async () => {
    const draft=structuredClone(content);
    draft.pages[0].modules=draft.pages[0].modules.filter(item=>item.kind!=='forms').map(item=>item.kind==='invoices' ? {...item,config:{...item.config,payments:false}} : item);
    draft.pages.push({id:'hidden',name:'Hidden Forms',path:'hidden-forms',modules:[{id:'hidden-forms',kind:'forms',config:{heading:'Forms',variant:'cards',limit:20}}]});
    await savePortalDraft(operator,org,await version(),draft);await submitPortalDraft(operator,org,await version());await publishPortalDraft(operator,org,await version());
    expect((await pg.query("select app.portal_exposed($1,'forms') forms,app.portal_exposed($1,'invoices',true) payments",[org])).rows[0]).toEqual({forms:false,payments:false});
    expect((await portal.rpc('portal_forms_available')).data).toEqual([]);
    expect((await portal.rpc('submit_portal_form',{p_form_id:randomUUID(),p_revision_id:randomUUID(),p_answers:{}})).error?.code).toBe('42501');
    expect((await portal.rpc('external_card_payment_availability',{p_invoice_id:randomUUID(),p_provider:'stripe'})).data).toEqual([]);
  });
  it('fails closed on commercial expiry and activation overrides without losing the snapshot', async () => {
    await pg.query("update organization_commercial_terms set period_end=current_date where organization_id=$1 and product_key='module:portal'",[org]);
    expect(await publishedPortalContent(portal)).toBeNull();
    await expect(publishPortalDraft(operator,org,await version())).rejects.toThrow('entitlement');
    await pg.query("update organization_commercial_terms set period_end='9999-12-31' where organization_id=$1 and product_key='module:portal'",[org]);
    const feature=(await pg.query("select id from platform_catalog_features where key='portal_auth'")).rows[0].id;
    await pg.query('insert into organization_feature_activation_overrides(organization_id,feature_id,disabled_by) values($1,$2,$3)',[org,feature,(await operator.auth.getUser()).data.user!.id]);
    expect(await publishedPortalContent(portal)).toBeNull();
    await pg.query('delete from organization_feature_activation_overrides where organization_id=$1 and feature_id=$2',[org,feature]);
    expect(await publishedPortalContent(portal)).not.toBeNull();
  });
  it('removes all reads on revocation', async () => {
    await revokePortalInvite(operator, { id: invite });
    expect(await publishedPortalContent(portal)).toBeNull();
    expect((await portal.from('portal_definitions').select('*')).data).toEqual([]);
  });
  it('uses current Plan feature grants and never falls back to legacy activation after Plan expiry', async () => {
    await setModuleEnabled(foreign,{organizationId:foreignOrg,key:'portal',enabled:true});
    const foreignCustomer=await createCustomer(foreign,{organizationId:foreignOrg,name:'Plan Portal customer'});
    const recipient=client();await exchangePortalLink(recipient,{token:await createPortalInvite(foreign,{customerId:foreignCustomer})});
    const staff=await asPlatformStaff();
    const planId=await createPlan(staff,{key:`portal_plan_${randomUUID().replaceAll('-','')}`,kind:'plan',label:'Portal verification Plan',description:'Local independent Plan fixture',billable:false,saleStatus:'active',displayOrder:0});
    const feature=(await pg.query("select id from platform_catalog_features where key='portal_auth'")).rows[0].id;
    await setPlanFeatureOverride(staff,{planId,featureId:feature,included:true});
    const assignment=await recordPlanAssignment(staff,{organizationId:foreignOrg,planId,periodStart:'2020-01-01',periodEnd:'9999-12-31',note:'Local Portal Plan verification'});
    expect((await portalModuleAvailability(foreign,foreignOrg)).publish).toBe(true);
    let current=(await portalEditorState(foreign,foreignOrg)).definition!.draft_version;
    await submitPortalDraft(foreign,foreignOrg,current);current=(await portalEditorState(foreign,foreignOrg)).definition!.draft_version;
    await publishPortalDraft(foreign,foreignOrg,current);expect(await publishedPortalContent(recipient)).toEqual(DEFAULT_PORTAL_CONTENT);
    await pg.query('update organization_plan_assignments set period_end=current_date where id=$1',[assignment]);
    expect(await publishedPortalContent(recipient)).toBeNull();
    expect((await portalModuleAvailability(foreign,foreignOrg)).publish).toBe(false);
    await pg.query("update organization_plan_assignments set period_end='9999-12-31' where id=$1",[assignment]);
  });
  it('attaches the linked tenant Portal by stable identity, refuses forged targets and rechecks revoked tenant access', async () => {
    const actor = (await operator.auth.getUser()).data.user!.id;
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [actor, 'Explicit fixture operator']);
    await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,created_by from memberships where organization_id=$1 limit 1', [foreignOrg, actor, 'Explicitly granted tenant manager']);
    const relationship = await operator.rpc('link_existing_client_tenant', { p_organization_id: org, p_customer_id: customer, p_tenant_id: foreignOrg, p_authority_basis: 'Authenticated fixture tenant-owner approval' });
    expect(relationship.error).toBeNull();
    const engagement = await createServiceEngagement(operator, { organizationId: org, customerId: customer, name: 'Portal implementation', serviceKind: 'implementation', relationshipId: relationship.data });
    const target = (await portalEditorState(foreign, foreignOrg)).definition!.id;
    const wrong = (await portalEditorState(operator, org)).definition!.id;
    expect((await listDeliverableOptions(operator, org, engagement)).some(row => row.kind === 'portal' && row.id === target)).toBe(true);
    await expect(attachEngagementDeliverable(operator, org, engagement, 'portal', wrong)).rejects.toThrow('Authorized tenant artifact unavailable');
    await attachEngagementDeliverable(operator, org, engagement, 'portal', target);
    await expect(attachEngagementDeliverable(operator, org, engagement, 'portal', target)).rejects.toThrow('already attached');
    expect((await listEngagementDeliverables(operator, org, engagement))[0]).toMatchObject({ kind: 'portal', artifact_id: target, available: true });
    await expect(pg.query('insert into engagement_deliverables(organization_id,engagement_id,tenant_organization_id,portal_id,created_by) values($1,$2,$3,$4,$5)', [org,engagement,foreignOrg,wrong,actor])).rejects.toMatchObject({ code: '23503' });
    await pg.query('delete from memberships where organization_id=$1 and user_id=$2', [foreignOrg, actor]);
    expect((await listEngagementDeliverables(operator, org, engagement))[0]).toMatchObject({ kind: 'portal', available: false, artifact_status: 'Tenant access required' });
    expect((await listDeliverableOptions(operator, org, engagement))).toEqual([]);
  });
  it('keeps older immutable revisions inspectable beyond the first bounded history page', async () => {
    const prior=(await portalEditorState(operator,org)).history.length;
    for(let index=0;index<51;index++){
      await savePortalDraft(operator,org,await version(),{...content,settings:{...content.settings,title:`Archive revision ${index}`}});
      await submitPortalDraft(operator,org,await version());await publishPortalDraft(operator,org,await version());
    }
    const first=(await portalEditorState(operator,org)).history;expect(first).toHaveLength(50);
    const older=await portalHistoryBefore(operator,org,first.at(-1)!.number);expect(older).toHaveLength(prior+51-50);
    expect(new Set([...first,...older].map(row=>row.id)).size).toBe(prior+51);
    expect(await portalHistoryBefore(foreign,org,first.at(-1)!.number)).toEqual([]);
    expect(await portalHistoryBefore(portal,org,first.at(-1)!.number)).toEqual([]);
  },60_000);
});
