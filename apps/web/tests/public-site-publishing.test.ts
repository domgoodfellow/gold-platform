import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { createHomepageDraft, homepageEditorState, publishHomepageRevision, publishedGoldHomepage, submitHomepageRevision, updateHomepageDraft } from '@/lib/domain/public-site/public-site';
import { foundBusiness } from './helpers/founding';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; organizationId: string; email: string };
let tenant: Tenant;
let other: Tenant;
let previousSite: string | null;
let previousSiteOrganization: string | null;
let initialRevision: string;
let draftRevision: string;

async function signUp(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, email };
}

async function newTenant(label: string): Promise<Tenant> {
  const account = await signUp(label);
  const organizationId = await foundBusiness({ ownerEmail: account.email, name: `${label} Ltd`, displayName: 'Owner', timezone: 'America/Toronto', currency: 'CAD' });
  return { ...account, organizationId };
}

async function pgQuery(text: string, values: unknown[] = []) {
  const pg = new Client(CONNECTION); await pg.connect();
  try { return await pg.query(text, values); } finally { await pg.end(); }
}

describe('reviewed public-site publishing', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Supabase test keys must be set.');
    tenant = await newTenant('public-site');
    other = await newTenant('public-site-other');
    const previous = (await pgQuery('select gold_public_organization_id,gold_public_site_id from public.platform_settings where singleton')).rows[0];
    previousSite = previous.gold_public_site_id;
    previousSiteOrganization = previous.gold_public_organization_id;
    const bootstrapped = await pgQuery('select app.bootstrap_gold_public_site($1) as site_id', [tenant.organizationId]);
    const state = await homepageEditorState(tenant.db, tenant.organizationId);
    if (!state?.published) throw new Error('Bootstrap did not publish the initial homepage.');
    initialRevision = state.published.id;
    expect(bootstrapped.rows[0].site_id).toBe(state.siteId);
  });

  afterAll(async () => {
    await pgQuery('update public.platform_settings set gold_public_organization_id=$1,gold_public_site_id=$2 where singleton', [previousSiteOrganization, previousSite]);
  });

  it('gives anonymous callers one published projection and no table access', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const page = await publishedGoldHomepage(anon);
    expect(page.organizationId).toBe(tenant.organizationId);
    expect(page.revisionId).toBe(initialRevision);
    expect(page.sections.map((section) => section.kind)).toEqual(['hero', 'problem', 'capabilities', 'process', 'trust', 'cta']);
    const direct = await anon.from('public_page_revisions').select('*');
    expect(direct.error?.code).toBe('42501');
    expect(direct.data).toBeNull();
  });

  it('keeps drafts private until a reviewed revision is published', async () => {
    draftRevision = await createHomepageDraft(tenant.db, tenant.organizationId);
    const state = await homepageEditorState(tenant.db, tenant.organizationId);
    const draft = state?.working;
    if (!draft) throw new Error('Draft missing.');
    const sections = structuredClone(draft.sections);
    const hero = sections.find((section) => section.kind === 'hero');
    if (!hero || hero.kind !== 'hero') throw new Error('Hero missing.');
    hero.heading = 'A reviewed homepage heading';
    await updateHomepageDraft(tenant.db, { organizationId: tenant.organizationId, revisionId: draftRevision, seoTitle: draft.seoTitle, seoDescription: draft.seoDescription, sections });
    expect((await publishedGoldHomepage(tenant.db)).revisionId).toBe(initialRevision);

    await submitHomepageRevision(tenant.db, tenant.organizationId, draftRevision);
    await expect(submitHomepageRevision(tenant.db, tenant.organizationId, draftRevision)).rejects.toThrow(/only a draft/i);
    expect((await publishedGoldHomepage(tenant.db)).revisionId).toBe(initialRevision);

    await publishHomepageRevision(tenant.db, tenant.organizationId, draftRevision);
    const published = await publishedGoldHomepage(tenant.db);
    expect(published.revisionId).toBe(draftRevision);
    expect(published.sections.find((section) => section.kind === 'hero')?.heading).toBe('A reviewed homepage heading');
    const history = await pgQuery('select id,status from public.public_page_revisions where organization_id=$1 order by revision_number', [tenant.organizationId]);
    expect(history.rows).toEqual([{ id: initialRevision, status: 'archived' }, { id: draftRevision, status: 'published' }]);
  });

  it('refuses insufficient and cross-tenant authority', async () => {
    const account = await signUp('public-site-viewer');
    const roleId = await createRole(tenant.db, { organizationId: tenant.organizationId, name: 'Viewer', capabilities: [] });
    await addMember(tenant.db, { organizationId: tenant.organizationId, email: account.email, displayName: 'Viewer', roleId });
    await expect(createHomepageDraft(account.db, tenant.organizationId)).rejects.toThrow(/insufficient privilege/i);
    await expect(publishHomepageRevision(other.db, tenant.organizationId, draftRevision)).rejects.toThrow(/insufficient privilege/i);
    await expect(createHomepageDraft(other.db, other.organizationId)).rejects.toThrow(/no public website is configured/i);
    const privateRead = await other.db.from('public_page_revisions').select('*');
    expect(privateRead.error?.code).toBe('42501');
  });

  it('enforces tenant-consistent references and immutable published content in PostgreSQL', async () => {
    const page = await pgQuery('select id,site_id from public.public_pages where organization_id=$1 and page_key=$2', [tenant.organizationId, 'home']);
    await expect(pgQuery('insert into public.public_pages (organization_id,site_id,page_key,slug) values ($1,$2,$3,$4)', [other.organizationId, page.rows[0].site_id, 'foreign', 'foreign'])).rejects.toThrow(/foreign key/i);
    await expect(pgQuery('update public.public_page_revisions set seo_title=$1 where organization_id=$2 and id=$3', ['Rewritten history', tenant.organizationId, draftRevision])).rejects.toThrow(/immutable/i);
  });
});
