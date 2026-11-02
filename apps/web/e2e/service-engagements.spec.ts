import { randomUUID } from 'node:crypto';
import { seedLegacyPlanProposal } from '../tests/support/legacy-proposals';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { Client } from 'pg';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createCustomer } from '../lib/domain/customers/customers';
import { createWebsite, siteEditorState } from '../lib/domain/public-site/public-site';
import { getPlan } from '../lib/domain/catalogue/plans';
import { markCommercialProposalSent, acceptCommercialProposal } from '../lib/domain/customers/commercial-proposals';
import { createProposalInvite, claimProposalInvite } from '../lib/domain/customers/proposal-invites';
import type { Database } from '../lib/db/types';

test.describe('Batch A CRM managed services', () => {
  test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true });
  test('links, provisions, attaches canonical artifacts and retains history at desktop, tablet and phone', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    config({ path: path.join(__dirname, '../../..', '.env.test') });
    const url = process.env.SUPABASE_URL!;
    const connection = process.env.SUPABASE_DB_URL!;
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !['localhost','127.0.0.1'].includes(new URL(connection).hostname)) throw new Error('Disposable local fixtures only.');
    const staff = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const staffEmail = `services-staff-${randomUUID()}@example.test`;
    const ownerEmail = `services-owner-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    const staffAccount = await admin.auth.admin.createUser({ email: staffEmail, password, email_confirm: true });
    if(staffAccount.error) throw staffAccount.error;
    const ownerAccount = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
    if(ownerAccount.error) throw ownerAccount.error;
    const authority = new Client(connection); await authority.connect();
    try { await authority.query('insert into platform_staff(user_id,name) values($1,$2)',[staffAccount.data.user.id,'Browser test operator']); }
    finally { await authority.end(); }
    const login = await staff.auth.signInWithPassword({ email: staffEmail, password });
    if(login.error) throw login.error;
    const owner = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
    const ownerLogin = await owner.auth.signInWithPassword({ email: ownerEmail, password });
    if(ownerLogin.error) throw ownerLogin.error;
    const org = await provisionOrganization(staff, { ownerEmail: staffEmail, name: `Service seller ${Date.now()}`, currency: 'CAD', displayName: 'Operator' });
    const tenantName = `Service tenant ${Date.now()}`;
    const tenant = await provisionOrganization(staff, { ownerEmail: staffEmail, name: tenantName, currency: 'CAD', displayName: 'Tenant owner' });
    const customer = await createCustomer(staff, { organizationId: org, name: 'Managed client', email: ownerEmail });
    const base = `/organizations/${org}/crm/contacts/${customer}`;
    const loginScope = new Client(connection); await loginScope.connect();
    try { await loginScope.query('delete from platform_staff where user_id=$1',[staffAccount.data.user.id]); }
    finally { await loginScope.end(); }
    await page.goto('/login'); await page.getByLabel('Email',{exact:true}).fill(staffEmail); await page.getByLabel('Password',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Log in',exact:true}).click(); await page.waitForURL(url => url.pathname !== '/login');
    const restoreScope = new Client(connection); await restoreScope.connect();
    try { await restoreScope.query('insert into platform_staff(user_id,name) values($1,$2)',[staffAccount.data.user.id,'Browser test operator']); }
    finally { await restoreScope.end(); }
    await page.goto(base);
    await page.getByRole('tab', { name: 'Commercial proposal', exact: true }).click();
    await expect(page.getByText('No GildOps organization linked.')).toBeVisible();
    await expect(page.getByText('No service engagements yet.')).toBeVisible();
    await page.getByText('Link existing organization', { exact: true }).click();
    await page.getByLabel('Organization', { exact: true }).selectOption(tenant);
    await page.getByLabel('Verified association basis').fill('Verified signed managed-service agreement TEST-42');
    await page.getByRole('button', { name: 'Link organization', exact: true }).click();
    await expect(page.getByText('Organization linked.', { exact: true })).toBeVisible();
    await expect(page.getByText(tenantName, { exact: true }).first()).toBeVisible();
    const duplicate = await staff.rpc('link_existing_client_tenant', { p_organization_id: org, p_customer_id: customer, p_tenant_id: tenant, p_authority_basis: 'Verified duplicate service agreement' });
    expect(duplicate.error?.code).toBe('23505');
    const unauthorized = await owner.rpc('link_existing_client_tenant', { p_organization_id: org, p_customer_id: customer, p_tenant_id: tenant, p_authority_basis: 'Forged service agreement' });
    expect(unauthorized.error?.code).toBe('42501');

    await createWebsite(staff, { organizationId: tenant });
    const site = (await siteEditorState(staff, tenant))!.siteId;
    const pg = new Client(connection); await pg.connect();
    const agent = randomUUID(); const deployment = randomUUID(); const automation = randomUUID();
    try {
      await pg.query('insert into ai_assistants(organization_id,id,name,created_by,updated_by) values($1,$2,$3,$4,$4)',[tenant,agent,'Client receptionist',login.data.user!.id]);
      await pg.query('insert into ai_assistant_deployments(organization_id,id,assistant_id,surface,display_name) values($1,$2,$3,$4,$5)', [tenant,deployment,agent,'operator_copilot','Client receptionist']);
      await pg.query('insert into automation_rules(organization_id,id,name,trigger_kind,trigger_event_action,created_by) values($1,$2,$3,$4,$5,$6)', [tenant,automation,'Client workflow','event','work_item.created',login.data.user!.id]);
      await pg.query("insert into organization_modules(organization_id,module_key,enabled_by) values($1,'automations',$2) on conflict do nothing", [tenant,login.data.user!.id]);
    } finally { await pg.end(); }

    for (const [name,kind,artifactKind,artifactId] of [['Website implementation','website','website',site],['AI receptionist','ai','ai_deployment',deployment],['Workflow automation','automation','automation',automation]]) {
      await page.getByRole('button', { name: 'Add engagement', exact: true }).click();
      const create = page.getByRole('dialog', { name: 'New engagement', exact: true });
      await create.getByLabel('Engagement name').fill(name);
      await create.getByLabel('Service', { exact: true }).selectOption(kind);
      await create.getByLabel('Linked organization').selectOption({ label: tenantName });
      await create.getByRole('button', { name: 'Create engagement', exact: true }).click();
      await expect(create).not.toBeVisible();
      const row = page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) });
      await row.getByRole('button', { name: 'View engagement' }).click();
      const detail = page.getByRole('dialog', { name, exact: true });
      await expect(detail.getByLabel('Existing artifact').locator(`option[value="${artifactKind}:${artifactId}"]`)).toHaveCount(1);
      await detail.getByLabel('Existing artifact').selectOption(`${artifactKind}:${artifactId}`);
      await detail.getByRole('button', { name: 'Attach deliverable', exact: true }).click();
      await expect(detail.getByText('Saved.', { exact: true })).toBeVisible();
      await expect(detail.getByRole('link', { name: `Open ${artifactKind === 'ai_deployment' ? 'AI deployment' : artifactKind === 'website' ? 'Website' : 'Automation'}`, exact: true })).toBeVisible();
      if(kind==='website') {
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(detail.getByRole('link', { name: 'Open Website' })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('engagement-phone.png'), fullPage: true });
        expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await detail.getByText('Manage engagement', { exact: true }).tap();
        await detail.getByLabel('Engagement status').selectOption('completed');
        await detail.getByRole('button', { name: 'Update engagement' }).click();
        await expect(detail.getByText('completed', { exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(detail).not.toBeVisible();
      await expect(row.getByRole('button', { name: 'View engagement' })).toBeFocused();
      await page.setViewportSize({ width: 1440, height: 900 });
    }

    const engagementRows = await staff.from('service_engagements').select('id,service_kind').eq('organization_id',org).eq('customer_id',customer);
    const openEngagement = engagementRows.data!.find(e => e.service_kind === 'automation')!.id;
    const foreignTenant = await provisionOrganization(staff,{ownerEmail:staffEmail,name:'Foreign artifact tenant',currency:'CAD',displayName:'Owner'});
    await createWebsite(staff,{organizationId:foreignTenant});
    const foreignSite = (await siteEditorState(staff,foreignTenant))!.siteId;
    const forged = await staff.rpc('attach_engagement_deliverable',{p_organization_id:org,p_engagement_id:openEngagement,p_kind:'website',p_artifact_id:foreignSite});
    expect(forged.error?.code).toBe('42501');
    const website = await staff.rpc('public_site_editor_state',{p_organization_id:tenant});
    expect(website.data).not.toBeNull();

    const plan = await getPlan(staff, 'start');
    const proposal = await seedLegacyPlanProposal({ createdBy: staffAccount.data.user.id,organizationId:org,customerId:customer,planId:plan!.id,addonPlanIds:[],currency:'CAD',billingInterval:'month'});
    await markCommercialProposalSent(staff,{organizationId:org,proposalId:proposal.id});
    const token = await createProposalInvite(staff,{customerId:customer});
    const visitor = createClient<Database>(url,process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false}});
    await claimProposalInvite(visitor,{token}); await acceptCommercialProposal(visitor,{proposalId:proposal.id});
    await page.reload(); await page.getByRole('tab',{name:'Commercial proposal',exact:true}).click();
    await page.getByRole('button',{name:'Create this business in GildOps',exact:true}).click();
    await expect(page.getByText('Linked through accepted proposal', { exact: false })).toBeVisible();
    const handoff = await staff.from('customer_proposal_handoffs').select('*').eq('organization_id',org).eq('proposal_id',proposal.id).single();
    const repeated = await staff.rpc('hand_off_accepted_proposal',{p_proposal_id:proposal.id});
    expect(repeated.data).toBe(handoff.data!.created_organization_id);
    const links = await staff.from('client_tenant_relationships').select('id').eq('organization_id',org).eq('originating_handoff_id',handoff.data!.id);
    expect(links.data).toHaveLength(1);
    const memberships = await staff.from('memberships').select('id').eq('organization_id',handoff.data!.created_organization_id).eq('user_id',staffAccount.data.user.id);
    expect(memberships.data).toEqual([]);
    const linkDisclosure = page.locator('details').filter({has:page.getByText('Link existing organization',{exact:true})});
    if(await linkDisclosure.evaluate(element => (element as HTMLDetailsElement).open)) await page.getByText('Link existing organization',{exact:true}).click();
    for(const viewport of [{width:1440,height:900},{width:820,height:1180},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await page.getByText('Platform relationship',{exact:true}).scrollIntoViewIfNeeded();
      await expect(page.getByRole('button',{name:'Add engagement'})).toBeVisible();
      expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`customer-${viewport.width}.png`),fullPage:true});
    }
    await page.getByText('Manage relationship',{exact:true}).first().click();
    await page.getByRole('button',{name:'End relationship',exact:true}).first().click();
    await expect(page.getByText('Relationship ended',{exact:true})).toBeVisible();
    const retained = await staff.from('engagement_deliverables').select('id').eq('organization_id',org);
    expect(retained.data).toHaveLength(3);
    const restricted = await staff.rpc('engagement_deliverable_summaries',{p_organization_id:org,p_engagement_id:openEngagement});
    expect(restricted.data?.[0]).toMatchObject({available:false,artifact_status:'Relationship ended'});
  });
});
