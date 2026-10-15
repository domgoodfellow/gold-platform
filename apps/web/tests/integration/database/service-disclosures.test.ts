import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Database, Db } from '@/lib/db/types';
import { foundBusiness } from '@/tests/support/founding';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createServiceEngagement, attachEngagementDeliverable, transitionServiceEngagement } from '@/lib/domain/customers/service-engagements';
import { parseDisclosureContent, saveServiceDisclosure, releaseServiceDisclosure, disclosureEditorState, portalServiceDisclosures, type DisclosureContent } from '@/lib/domain/customers/service-disclosures';
import { createPortalInvite, exchangePortalLink, revokePortalInvite, listPortalInvites } from '@/lib/domain/portal/portal';
import { savePortalDraft, submitPortalDraft, publishPortalDraft, portalEditorState, portalModuleAvailability } from '@/lib/domain/portal/definitions';
import { DEFAULT_PORTAL_CONTENT, portalFromTemplate, parsePortalContent } from '@/lib/domain/portal/composition';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createWebsite, siteEditorState, submitSiteRevision, publishSiteRevision } from '@/lib/domain/public-site/public-site';
import { createForm, saveFormDraft, publishFormRevision } from '@/lib/domain/forms/forms';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';

const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const connection = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const client = () => createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
let pg: Client; let operator: Db; let foreign: Db; let portal: Db; let otherPortal: Db; let tenantPortal: Db;
let org: string; let tenant: string; let unrelated: string; let customer: string; let otherCustomer: string; let engagement: string; let relationship: string; let actor: string; let tenantActor: string; let deliverable: string;
let disclosureId: string;
const content: DisclosureContent = { title: 'Website implementation', serviceKind: 'website', summary: 'The design is ready for review.', status: 'Ready for review', deliverables: [] };
const state = () => disclosureEditorState(operator, org, customer, engagement);
const version = async () => (await state()).disclosure?.version ?? 0;
async function publishLayout(value = portalFromTemplate('managed-services')) {
  const version = (await portalEditorState(operator, org)).definition?.draft_version ?? 0;
  await savePortalDraft(operator, org, version, value);
  await submitPortalDraft(operator, org, (await portalEditorState(operator, org)).definition!.draft_version);
  await publishPortalDraft(operator, org, (await portalEditorState(operator, org)).definition!.draft_version);
}
beforeAll(async () => {
  if (![url, connection].every(value => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname))) throw new Error('Disposable local fixtures only');
  pg = new Client(connection); await pg.connect();
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  async function account(label: string) {
    const email = `${label}-${randomUUID()}@example.test`; const password = `pw-${randomUUID()}`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (made.error) throw made.error;
    const db = client(); const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
    return { db, email, id: made.data.user.id };
  }
  const seller = await account('disclosure-seller'); const owner = await account('disclosure-tenant');
  operator = seller.db; foreign = owner.db; actor = seller.id; tenantActor = owner.id;
  org = await foundBusiness({ ownerEmail: seller.email, name: 'GildOps Internal fixture', currency: 'CAD' });
  tenant = await foundBusiness({ ownerEmail: owner.email, name: 'Acme Tenant fixture', currency: 'CAD' });
  unrelated = await foundBusiness({ ownerEmail: owner.email, name: 'Unrelated Tenant fixture', currency: 'CAD' });
  customer = await createCustomer(operator, { organizationId: org, name: 'Acme Plumbing' });
  otherCustomer = await createCustomer(operator, { organizationId: org, name: 'Second Business' });
  await setModuleEnabled(operator, { organizationId: org, key: 'portal', enabled: true });
  await setModuleEnabled(foreign, { organizationId: tenant, key: 'portal', enabled: true });
  await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:portal','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local Batch C verification')", [org, actor]);
  portal = client(); otherPortal = client(); tenantPortal = client();
  await exchangePortalLink(portal, { token: await createPortalInvite(operator, { customerId: customer }) });
  await exchangePortalLink(otherPortal, { token: await createPortalInvite(operator, { customerId: otherCustomer }) });
  const tenantCustomer = await createCustomer(foreign, { organizationId: tenant, name: 'Acme customer' });
  await exchangePortalLink(tenantPortal, { token: await createPortalInvite(foreign, { customerId: tenantCustomer }) });
  const made = await pg.query("insert into client_tenant_relationships(organization_id,customer_id,tenant_organization_id,origin,authority_basis,created_by) values($1,$2,$3,'existing_tenant_link','Local verified fixture',$4) returning id", [org, customer, tenant, actor]);
  relationship = made.rows[0].id;
  engagement = await createServiceEngagement(operator, { organizationId: org, customerId: customer, name: 'PRIVATE internal engagement', serviceKind: 'website', relationshipId: relationship });
});
afterAll(async () => { await pg?.end(); });
describe('approved customer service communication boundary', () => {
  it('defaults to private and refuses direct reads before published module exposure', async () => {
    expect((await state()).disclosure).toBeNull();
    expect((await portal.rpc('portal_service_disclosures')).error?.code).toBe('42501');
    await publishLayout();
    expect(await portalServiceDisclosures(portal)).toEqual([]);
    expect((await portalModuleAvailability(portal)).services).toBe(false);
  });
  it('validates bounded draft data identically in TypeScript and PostgreSQL', async () => {
    for (const value of [content, null, {}, { ...content, accepted_terms: {} }, { ...content, title: '' }, { ...content, serviceKind: 'secrets' }, { ...content, summary: 'x'.repeat(3001) }, { ...content, deliverables: [{ deliverableId: randomUUID(), title: 'X', summary: '', status: 'Y', shareLink: true, url: 'https://evil.test' }] }]) {
      let valid = true; try { parseDisclosureContent(value); } catch { valid = false; }
      expect((await pg.query('select app.valid_service_disclosure($1::jsonb) valid', [JSON.stringify(value)])).rows[0].valid).toBe(valid);
    }
    for (const variant of ['list','cards','summary','private']) {
      const layout = portalFromTemplate('managed-services'); layout.pages[0].modules[0].config.variant = variant;
      let valid = true; try { parsePortalContent(layout); } catch { valid = false; }
      expect((await pg.query('select app.valid_portal_content($1::jsonb) valid', [JSON.stringify(layout)])).rows[0].valid).toBe(valid);
    }
  });
  it('refuses customer reassignment, wrong organization, Portal writes and staff without seller capability', async () => {
    await expect(saveServiceDisclosure(operator, org, otherCustomer, engagement, 0, content)).rejects.toThrow('unavailable');
    await expect(saveServiceDisclosure(operator, unrelated, customer, engagement, 0, content)).rejects.toThrow();
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [tenantActor, 'No seller authority']);
    for (const db of [foreign, portal]) {
      await expect(saveServiceDisclosure(db, org, customer, engagement, 0, content)).rejects.toThrow('permission');
      await expect(releaseServiceDisclosure(db, org, customer, engagement, 0, 'publish')).rejects.toThrow('permission');
    }
    await pg.query('delete from platform_staff where user_id=$1', [tenantActor]);
    expect((await pg.query("select has_table_privilege('authenticated','service_disclosures','UPDATE') u,has_table_privilege('authenticated','service_disclosure_revisions','DELETE') d")).rows[0]).toEqual({ u: false, d: false });
    const role = randomUUID();
    await pg.query("insert into roles(organization_id,id,name,capabilities,created_by) values($1,$2,'Read only','{}',$3)", [org,role,actor]);
    await pg.query("insert into memberships(organization_id,user_id,role_id,display_name,created_by) values($1,$2,$3,'Read only',$4)", [org,tenantActor,role,actor]);
    await expect(saveServiceDisclosure(foreign, org, customer, engagement, 0, content)).rejects.toThrow('permission');
    await pg.query('delete from memberships where organization_id=$1 and user_id=$2',[org,tenantActor]);
  });
  it('preserves approved history while draft edits stay private and refuses concurrent stale publication', async () => {
    disclosureId = await saveServiceDisclosure(operator, org, customer, engagement, 0, content);
    expect(await portalServiceDisclosures(portal)).toEqual([]);
    const current = await version();
    const releases = await Promise.allSettled([0,1].map(() => releaseServiceDisclosure(operator, org, customer, engagement, current, 'publish')));
    expect(releases.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const revision = (await state()).history[0]; expect(revision.published_by).toBe(actor);
    await expect(pg.query('update service_disclosure_revisions set content=$1 where organization_id=$2 and id=$3', [JSON.stringify(content), org, revision.id])).rejects.toThrow('immutable');
    expect((await portalServiceDisclosures(portal))[0]).toMatchObject({ id: disclosureId, title: content.title, summary: content.summary });
    expect(await portalServiceDisclosures(otherPortal)).toEqual([]);
    expect((await otherPortal.rpc('portal_service_disclosures', { p_disclosure_id: disclosureId })).error?.code).toBe('42501');
    expect((await tenantPortal.rpc('portal_service_disclosures', { p_disclosure_id: disclosureId })).error?.code).toBe('42501');
    expect((await portal.from('service_disclosures').select('*')).data).toEqual([]);
    expect((await operator.from('public_sites').select('id').eq('organization_id', tenant)).error?.code).toBe('42501');
    const stale = await version();
    const drafts = await Promise.allSettled([0,1].map(i => saveServiceDisclosure(operator, org, customer, engagement, stale, { ...content, summary: `PRIVATE draft ${i}` })));
    expect(drafts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await portalServiceDisclosures(portal))[0].summary).toBe(content.summary);
    expect((await state()).history[0]).toEqual(revision);
    expect(Object.keys((await portalServiceDisclosures(portal))[0]).sort()).toEqual(['deliverables','id','publishedAt','serviceKind','status','summary','title']);
  });
  it('requires an attached deliverable, active relationship and independent artifact authority', async () => {
    const forged = { ...content, deliverables: [{ deliverableId: randomUUID(), title: 'Receptionist', summary: '', status: 'Testing', shareLink: false }] };
    await expect(saveServiceDisclosure(operator, org, customer, engagement, await version(), forged)).rejects.toThrow('unavailable');
    await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,$4 from memberships where organization_id=$1 and user_id=$4', [tenant,actor,'Independent tenant access',tenantActor]);
    const agent = randomUUID(); const deployment = randomUUID();
    await pg.query('insert into ai_assistants(organization_id,id,name,created_by,updated_by) values($1,$2,$3,$4,$4)', [tenant,agent,'PRIVATE config',tenantActor]);
    await pg.query("insert into ai_assistant_deployments(organization_id,id,assistant_id,surface) values($1,$2,$3,'operator_copilot')", [tenant,deployment,agent]);
    deliverable = await attachEngagementDeliverable(operator, org, engagement, 'ai_deployment', deployment);
    const update = { ...content, deliverables: [{ deliverableId: deliverable, title: 'AI receptionist', summary: 'Configuration prepared.', status: 'Testing in progress', shareLink: false }] };
    await expect(saveServiceDisclosure(operator, org, customer, engagement, await version(), { ...update, deliverables: [{ ...update.deliverables[0], shareLink: true }] })).rejects.toThrow('public destination');
    await saveServiceDisclosure(operator, org, customer, engagement, await version(), update);
    await pg.query('delete from memberships where organization_id=$1 and user_id=$2', [tenant,actor]);
    await expect(releaseServiceDisclosure(operator, org, customer, engagement, await version(), 'publish')).rejects.toThrow('authority');
    await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,$4 from memberships where organization_id=$1 and user_id=$4', [tenant,actor,'Independent tenant access',tenantActor]);
    await releaseServiceDisclosure(operator, org, customer, engagement, await version(), 'publish');
    const visible = JSON.stringify(await portalServiceDisclosures(portal));
    expect(visible).toContain('Testing in progress');
    for (const privateValue of [deployment, agent, tenant, deliverable, 'accepted_terms', 'PRIVATE config', 'enabled']) expect(visible).not.toContain(privateValue);
    await pg.query('delete from memberships where organization_id=$1 and user_id=$2', [tenant,actor]);
  });
  it('approves all typed presentations and derives safe public URLs from canonical resources only', async () => {
    await pg.query('insert into memberships(organization_id,user_id,role_id,display_name,created_by) select organization_id,$2,role_id,$3,$4 from memberships where organization_id=$1 and user_id=$4', [tenant,actor,'Independent tenant access',tenantActor]);
    await createWebsite(foreign, {organizationId:tenant});
    const website=(await siteEditorState(foreign,tenant))!;
    await submitSiteRevision(foreign,tenant,website.working!.id);await publishSiteRevision(foreign,tenant,website.working!.id);
    const form=await createForm(foreign,{organizationId:tenant,name:'Public intake'});
    await saveFormDraft(foreign,{organizationId:tenant,revisionId:form.revisionId,definition:{title:'Public intake',submitLabel:'Send',confirmation:{title:'Received',message:''},fields:[{id:'note',type:'short_text',label:'Note',required:false}]}});
    await publishFormRevision(foreign,{organizationId:tenant,revisionId:form.revisionId});
    await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:portal','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local typed Portal fixture')", [tenant,tenantActor]);
    await savePortalDraft(foreign,tenant,0,DEFAULT_PORTAL_CONTENT);await submitPortalDraft(foreign,tenant,(await portalEditorState(foreign,tenant)).definition!.draft_version);await publishPortalDraft(foreign,tenant,(await portalEditorState(foreign,tenant)).definition!.draft_version);
    const portalIdentity=(await portalEditorState(foreign,tenant)).definition!.id;
    const automation=randomUUID();
    await pg.query("insert into organization_modules(organization_id,module_key,enabled_by) values($1,'automations',$2) on conflict do nothing",[tenant,tenantActor]);
    await pg.query("insert into automation_rules(organization_id,id,name,trigger_kind,trigger_event_action,created_by) values($1,$2,'PRIVATE workflow','event','work_item.created',$3)",[tenant,automation,tenantActor]);
    const items=[];
    for(const [kind,id] of [['website',website.siteId],['form',form.formId],['portal',portalIdentity],['automation',automation]] as const) {
      const reference=await attachEngagementDeliverable(operator,org,engagement,kind,id);
      items.push({deliverableId:reference,title:`Approved ${kind}`,summary:'Approved delivery summary',status:'Ready for review',shareLink:kind!=='automation'});
    }
    await expect(saveServiceDisclosure(operator,org,customer,engagement,await version(),{...content,deliverables:items})).rejects.toThrow('public destination');
    const domains:string[]=[];const hosts:string[]=[];
    for(const surface of ['website','portal']) {
      const host=`disclosure-${surface}-${randomUUID()}.example.test`;hosts.push(host);
      const domain=await foreign.rpc('begin_custom_domain_connection',{p_organization_id:tenant,p_hostname:host,p_surface:surface});if(domain.error)throw domain.error;domains.push(domain.data);
      await pg.query('begin');await pg.query('set local role provider_operator');
      await pg.query("select record_custom_domain_registration($1,$2,'satisfied','[]'::jsonb,null,null)",[tenant,domain.data]);
      await pg.query("select set_custom_domain_verification($1,$2,'verified','satisfied','issued',null,null,null)",[tenant,domain.data]);await pg.query('commit');
    }
    await saveServiceDisclosure(operator,org,customer,engagement,await version(),{...content,deliverables:items});
    await releaseServiceDisclosure(operator,org,customer,engagement,await version(),'publish');
    const presented=(await portalServiceDisclosures(portal))[0].deliverables;
    expect(presented.map(d=>d.kind).sort()).toEqual(['automation','form','portal','website']);
    expect(presented.find(d=>d.kind==='website')?.url).toBe(`https://${hosts[0]}/`);
    expect(presented.find(d=>d.kind==='form')?.url).toMatch(new RegExp(`^https://${hosts[0]}/forms/`));
    expect(presented.find(d=>d.kind==='portal')?.url).toBe(`https://${hosts[1]}/portal`);
    expect(presented.find(d=>d.kind==='automation')?.url).toBeNull();
    await pg.query('update organization_domains set released_at=now(),released_by=created_by where id=$1',[domains[0]]);
    expect((await portalServiceDisclosures(portal))[0].deliverables.filter(d=>['website','form'].includes(d.kind)).every(d=>d.url===null)).toBe(true);
    await pg.query('delete from memberships where organization_id=$1 and user_id=$2',[tenant,actor]);
  });
  it('keeps seller communications but suspends tenant presentations on relationship ending without deleting artifacts', async () => {
    await operator.rpc('end_client_tenant_relationship', { p_organization_id: org, p_relationship_id: relationship });
    expect((await portalServiceDisclosures(portal))[0].deliverables).toEqual([]);
    await expect(releaseServiceDisclosure(operator, org, customer, engagement, await version(), 'publish')).rejects.toThrow('relationship');
    expect((await pg.query('select count(*) n from ai_assistant_deployments where organization_id=$1', [tenant])).rows[0].n).toBe('1');
    await saveServiceDisclosure(operator, org, customer, engagement, await version(), content);
    await releaseServiceDisclosure(operator, org, customer, engagement, await version(), 'publish');
    const before = await portalServiceDisclosures(portal);
    await transitionServiceEngagement(operator, org, engagement, 'active');
    await transitionServiceEngagement(operator, org, engagement, 'completed');
    expect(await portalServiceDisclosures(portal)).toEqual(before);
    const cancelled = await createServiceEngagement(operator, { organizationId: org, customerId: customer, name: 'Cancelled independently', serviceKind: 'implementation' });
    await transitionServiceEngagement(operator, org, cancelled, 'cancelled');
    expect(await portalServiceDisclosures(portal)).toEqual(before);
  });
  it('enforces module publication independently of disclosure publication', async () => {
    const v = (await portalEditorState(operator, org)).definition!.draft_version;
    await savePortalDraft(operator, org, v, DEFAULT_PORTAL_CONTENT);
    expect(await portalServiceDisclosures(portal)).toHaveLength(1);
    await submitPortalDraft(operator, org, (await portalEditorState(operator, org)).definition!.draft_version);
    await publishPortalDraft(operator, org, (await portalEditorState(operator, org)).definition!.draft_version);
    expect((await portal.rpc('portal_service_disclosures')).error?.code).toBe('42501');
    await publishLayout();
    await setModuleEnabled(operator, { organizationId: org, key: 'portal', enabled: false });
    expect((await portal.rpc('portal_service_disclosures')).error?.code).toBe('42501');
    await setModuleEnabled(operator, { organizationId: org, key: 'portal', enabled: true });
    await pg.query("update organization_commercial_terms set period_end='2020-01-02' where organization_id=$1 and product_key='module:portal'", [org]);
    expect((await portal.rpc('portal_service_disclosures')).error?.code).toBe('42501');
    await pg.query("update organization_commercial_terms set period_end='9999-12-31' where organization_id=$1 and product_key='module:portal'", [org]);
  });
  it('withdraws immediately, retains history and refuses direct detail reads and expired or revoked invitations', async () => {
    const history = (await state()).history;
    await releaseServiceDisclosure(operator, org, customer, engagement, await version(), 'withdraw');
    expect(await portalServiceDisclosures(portal)).toEqual([]);
    expect((await portal.rpc('portal_service_disclosures', { p_disclosure_id: disclosureId })).error?.code).toBe('42501');
    expect((await state()).history).toEqual(history);
    const timeline=await listCustomerTimeline(operator,{organizationId:org,customerId:customer});
    for(const label of ['Customer service update saved as draft','Customer service update published','Customer service update withdrawn']) expect(timeline.some(item=>item.description===label)).toBe(true);
    await releaseServiceDisclosure(operator, org, customer, engagement, await version(), 'publish');
    const invite = (await listPortalInvites(operator, { organizationId: org, customerId: customer }))[0];
    await pg.query("update external_actors set portal_expires_at=now()-interval '1 minute' where portal_invite_id=$1", [invite.id]);
    expect((await portal.rpc('portal_service_disclosures')).error?.code).toBe('42501');
    await pg.query("update external_actors set portal_expires_at=now()+interval '1 day' where portal_invite_id=$1", [invite.id]);
    await revokePortalInvite(operator, { id: invite.id });
    expect((await portal.rpc('portal_service_disclosures')).error?.code).toBe('42501');
  });
});
