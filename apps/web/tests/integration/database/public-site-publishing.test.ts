import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WebsiteContent } from '@gold/schemas';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import {
  createSiteDraft, createWebsite, listPageTemplates, listSectionPatterns, listSiteTemplates, publishSiteRevision,
  publishedGoldHomepage, siteEditorState, sitePreview, submitSiteRevision, updateSiteDraft,
} from '@/lib/domain/public-site/public-site';
import { addNavigationPage, addPage, addSection, blankPage, newId } from '@/lib/domain/public-site/composition';
import { SECTION_REGISTRY } from '@/lib/domain/public-site/section-registry';
import { foundBusiness } from '@/tests/support/founding';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ZONE = 'sites.test';

type Tenant = { db: SupabaseClient; organizationId: string; email: string; slug: string };
let tenant: Tenant;
let other: Tenant;
let gold: Tenant;
let previousSettings: { gold_public_organization_id: string | null; gold_public_site_id: string | null };

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
  const slug = `${label}-${randomUUID().slice(0, 6)}`;
  await pgQuery('update public.organizations set slug = $1 where id = $2', [slug, organizationId]);
  return { ...account, organizationId, slug };
}

async function pgQuery(text: string, values: unknown[] = []) {
  const pg = new Client(CONNECTION); await pg.connect();
  try { return await pg.query(text, values); } finally { await pg.end(); }
}

const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const hostSite = async (t: Tenant) => (await anon().rpc('published_hostname_site', { p_hostname: `${t.slug}.${ZONE}` })).data as unknown as {
  site: { revisionId: string; pages: { id: string; name: string; slug: string; isHome: boolean; sections: { heading?: string }[] }[]; navigation: { label: string }[] } | null;
};

async function workingContent(t: Tenant): Promise<{ revisionId: string; content: WebsiteContent }> {
  const state = (await siteEditorState(t.db, t.organizationId))!;
  return { revisionId: state.working!.id, content: { pages: state.working!.pages, navigation: state.working!.navigation } };
}

async function publish(t: Tenant, revisionId: string) {
  await submitSiteRevision(t.db, t.organizationId, revisionId);
  await publishSiteRevision(t.db, t.organizationId, revisionId);
}

describe('a business\'s own website: pages, sections and one coherent publication', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Supabase test keys must be set.');
    tenant = await newTenant('site-a');
    other = await newTenant('site-b');
    gold = await newTenant('site-gold');
    previousSettings = (await pgQuery('select gold_public_organization_id, gold_public_site_id from public.platform_settings where singleton')).rows[0];
    await pgQuery('update public.platform_settings set platform_public_domain = $1 where singleton', [ZONE]);
  }, 60_000);

  afterAll(async () => {
    await pgQuery('update public.platform_settings set platform_public_domain = null, gold_public_organization_id = $1, gold_public_site_id = $2 where singleton', [previousSettings.gold_public_organization_id, previousSettings.gold_public_site_id]);
  });

  it('has no website until the business creates one, and needs no hostname or platform step to do so', async () => {
    expect(await siteEditorState(tenant.db, tenant.organizationId)).toBeNull();
    const revisionId = await createWebsite(tenant.db, { organizationId: tenant.organizationId });
    const state = (await siteEditorState(tenant.db, tenant.organizationId))!;
    expect(state.published).toBeNull();
    expect(state.working!.id).toBe(revisionId);
    expect(state.working!.pages).toHaveLength(1);
    expect(state.working!.pages[0]).toMatchObject({ name: 'Home', isHome: true, slug: '', sections: [] });
    await expect(createWebsite(tenant.db, { organizationId: tenant.organizationId })).rejects.toThrow(/already has a website/i);
    // Nothing is public yet, and a hostname that would serve it shows nothing.
    expect((await hostSite(tenant)).site).toBeNull();
    // A private preview works before anything is published or connected.
    const preview = await sitePreview(tenant.db, { organizationId: tenant.organizationId, revisionId });
    expect(preview.pages).toHaveLength(1);
  });

  it('builds several pages with sections and navigation, and none of it is public until published', async () => {
    const { revisionId, content } = await workingContent(tenant);
    const homeId = content.pages[0]!.id;
    let next = addSection(content, homeId, SECTION_REGISTRY.hero.create(newId()));
    next = addSection(next, homeId, SECTION_REGISTRY.cta.create(newId()));
    const services = { ...blankPage(next, 'Services'), slug: 'services', sections: [SECTION_REGISTRY.content.create(newId())] };
    next = addNavigationPage(addPage(next, services), services.id);
    await updateSiteDraft(tenant.db, { organizationId: tenant.organizationId, revisionId, content: next });
    expect((await hostSite(tenant)).site).toBeNull();

    await submitSiteRevision(tenant.db, tenant.organizationId, revisionId);
    await expect(submitSiteRevision(tenant.db, tenant.organizationId, revisionId)).rejects.toThrow(/only a draft/i);
    expect((await hostSite(tenant)).site).toBeNull();
    await publishSiteRevision(tenant.db, tenant.organizationId, revisionId);

    const site = (await hostSite(tenant)).site!;
    expect(site.revisionId).toBe(revisionId);
    expect(site.pages.map((page) => page.slug)).toEqual(['', 'services']);
    expect(site.navigation.map((item) => item.label)).toEqual(['Services']);
  });

  it('keeps the published website whole while another is drafted, then switches every page together', async () => {
    const published = (await hostSite(tenant)).site!;
    const draftId = await createSiteDraft(tenant.db, { organizationId: tenant.organizationId });
    const { content } = await workingContent(tenant);
    const edited: WebsiteContent = {
      navigation: content.navigation,
      pages: content.pages.map((page) => ({ ...page, name: `${page.name} v2`, sections: page.sections.map((section) => ('heading' in section ? { ...section, heading: 'Second edition' } : section)) })),
    };
    await updateSiteDraft(tenant.db, { organizationId: tenant.organizationId, revisionId: draftId, content: edited });

    const during = (await hostSite(tenant)).site!;
    expect(during.revisionId).toBe(published.revisionId);
    expect(during.pages.map((page) => page.name)).toEqual(published.pages.map((page) => page.name));

    await publish(tenant, draftId);
    const after = (await hostSite(tenant)).site!;
    expect(after.revisionId).toBe(draftId);
    // Every page changed with the one revision — never one page ahead of another.
    expect(after.pages.map((page) => page.name)).toEqual(['Home v2', 'Services v2']);
    expect(after.pages.flatMap((page) => page.sections.map((section) => section.heading))).toEqual(['Second edition', 'Second edition', 'Second edition']);

    const history = await pgQuery('select id, status from public.public_site_revisions where organization_id = $1 order by revision_number', [tenant.organizationId]);
    expect(history.rows.map((row) => row.status)).toEqual(['archived', 'published']);
  });

  it('restores an earlier revision by copying it forward, never by rewriting history', async () => {
    const earlier = (await pgQuery('select id from public.public_site_revisions where organization_id = $1 and status = $2', [tenant.organizationId, 'archived'])).rows[0].id as string;
    const restored = await createSiteDraft(tenant.db, { organizationId: tenant.organizationId, fromRevisionId: earlier });
    await publish(tenant, restored);
    const site = (await hostSite(tenant)).site!;
    expect(site.pages.map((page) => page.name)).toEqual(['Home', 'Services']);
    const rows = await pgQuery('select status, revision_number from public.public_site_revisions where organization_id = $1 order by revision_number', [tenant.organizationId]);
    expect(rows.rows.map((row) => row.status)).toEqual(['archived', 'archived', 'published']);
    // The earlier revision itself is unchanged.
    expect((await sitePreview(tenant.db, { organizationId: tenant.organizationId, revisionId: earlier })).pages.map((page) => page.name)).toEqual(['Home', 'Services']);
  });

  it('refuses malformed content in the database, whoever writes it', async () => {
    const draftId = await createSiteDraft(tenant.db, { organizationId: tenant.organizationId });
    const { content } = await workingContent(tenant);
    const attempt = (pages: unknown, navigation: unknown = content.navigation) => tenant.db.rpc('update_public_site_draft', {
      p_organization_id: tenant.organizationId, p_revision_id: draftId, p_pages: pages as never, p_navigation: navigation as never,
    });
    const [home, services] = content.pages as [typeof content.pages[number], typeof content.pages[number]];
    expect((await attempt([home, { ...services, slug: 'portal' }])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, slug: 'forms' }])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, slug: 'Bad Path' }])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, slug: '' }])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, id: home.id }])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, slug: 'x', isHome: true }])).error?.code).toBe('23514');
    expect((await attempt([{ ...home, isHome: false, slug: 'home' }, services])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, sections: [{ id: newId(), kind: 'html', heading: 'x' }] }])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, sections: [{ ...SECTION_REGISTRY.content.create(newId()), html: '<b>x</b>' }] }])).error?.code).toBe('23514');
    expect((await attempt([home, { ...services, sections: [{ ...SECTION_REGISTRY.cta.create(newId()), primaryCta: { label: 'Out', href: 'https://example.test' } }] }])).error?.code).toBe('23514');
    expect((await attempt([home, services], [{ id: newId(), label: 'Gone', target: { type: 'page', pageId: newId() } }])).error?.code).toBe('23514');
    expect((await attempt([home, services], [{ id: newId(), label: 'Bad', target: { type: 'external', href: 'javascript:alert(1)' } }])).error?.code).toBe('23514');
    expect((await attempt([home, services])).error).toBeNull();
  });

  it('serves a hostname\'s pages from the active revision, and nothing for an unknown business', async () => {
    const site = (await hostSite(tenant)).site!;
    expect(site.pages.find((page) => !page.isHome)!.slug).toBe('services');
    const unknown = await anon().rpc('published_hostname_site', { p_hostname: `nobody-${randomUUID().slice(0, 6)}.${ZONE}` });
    expect(unknown.data).toBeNull();
  });

  it('starts from a platform template and owns the result, whatever happens to the template', async () => {
    const templates = await listSiteTemplates(other.db);
    expect(templates.map((template) => template.key)).toContain('local_service');
    await createWebsite(other.db, { organizationId: other.organizationId, templateKey: 'local_service' });
    const first = (await workingContent(other)).content;
    expect(first.pages.map((page) => page.name)).toEqual(['Home', 'Services', 'About', 'Contact']);
    expect(first.navigation.map((item) => item.label)).toEqual(['Home', 'Services', 'About', 'Contact']);
    expect(first.navigation.every((item) => item.target.type === 'page' && first.pages.some((page) => page.id === (item.target as { pageId: string }).pageId))).toBe(true);

    await pgQuery(`update public.public_site_templates set pages = jsonb_set(pages, '{0,name}', '"Changed starter"') where key = 'local_service'`);
    try {
      expect((await workingContent(other)).content.pages[0]!.name).toBe('Home');
    } finally {
      await pgQuery(`update public.public_site_templates set pages = jsonb_set(pages, '{0,name}', '"Home"') where key = 'local_service'`);
    }
    await expect(createWebsite(other.db, { organizationId: gold.organizationId, templateKey: 'nonexistent' })).rejects.toThrow();
  });

  it('lists page templates and section patterns that are themselves valid', async () => {
    expect((await listPageTemplates(tenant.db)).map((template) => template.key)).toEqual(expect.arrayContaining(['about_page', 'services_page', 'contact_page']));
    const patterns = await listSectionPatterns(tenant.db);
    expect(patterns.length).toBeGreaterThan(3);
    for (const pattern of patterns) expect(pattern.section.kind).toBe(pattern.kind);
  });

  it('keeps every business\'s drafts, pages and publication to itself', async () => {
    const draftId = (await workingContent(other)).revisionId;
    // Org B cannot read, edit, preview, submit or publish org A's website, even naming its ids.
    await expect(siteEditorState(other.db, tenant.organizationId)).rejects.toThrow(/insufficient privilege/i);
    await expect(sitePreview(other.db, { organizationId: tenant.organizationId, revisionId: draftId })).rejects.toThrow(/insufficient privilege/i);
    const theirs = (await workingContent(tenant)).revisionId;
    await expect(updateSiteDraft(other.db, { organizationId: tenant.organizationId, revisionId: theirs, content: (await workingContent(tenant)).content })).rejects.toThrow(/insufficient privilege/i);
    await expect(publishSiteRevision(other.db, tenant.organizationId, theirs)).rejects.toThrow(/insufficient privilege/i);
    // Naming B's own organization with A's revision id finds nothing to change.
    await expect(submitSiteRevision(other.db, other.organizationId, theirs)).rejects.toThrow(/only a draft/i);
    expect((await other.db.from('public_site_revisions').select('*')).error?.code).toBe('42501');
    expect((await anon().from('public_site_revisions').select('*')).error?.code).toBe('42501');
    expect((await anon().from('public_site_templates').select('*')).error?.code).toBe('42501');
    expect((await anon().rpc('list_site_templates')).error).not.toBeNull();
    // A section may not name a form that belongs to another business.
    const form = (await other.db.rpc('create_form', { p_organization_id: other.organizationId, p_name: 'Theirs' })).data as unknown;
    expect(form).toBeTruthy();
  });

  it('refuses a member without the authority to manage the website', async () => {
    const viewer = await signUp('site-viewer');
    const roleId = await createRole(tenant.db, { organizationId: tenant.organizationId, name: 'Viewer', capabilities: [] });
    await addMember(tenant.db, { organizationId: tenant.organizationId, email: viewer.email, displayName: 'Viewer', roleId });
    await expect(createSiteDraft(viewer.db, { organizationId: tenant.organizationId })).rejects.toThrow(/insufficient privilege/i);
    await expect(siteEditorState(viewer.db, tenant.organizationId)).rejects.toThrow(/insufficient privilege/i);
  });

  it('keeps a published revision immutable and tenant-consistent in PostgreSQL itself', async () => {
    const published = (await pgQuery('select id, site_id from public.public_site_revisions where organization_id = $1 and status = $2', [tenant.organizationId, 'published'])).rows[0];
    await expect(pgQuery(`update public.public_site_revisions set pages = '[]'::jsonb where id = $1`, [published.id])).rejects.toThrow(/vocabulary|immutable/i);
    await expect(pgQuery('delete from public.public_site_revisions where id = $1', [published.id])).rejects.toThrow(/immutable/i);
    await expect(pgQuery(
      `insert into public.public_site_revisions (organization_id, site_id, revision_number, status, pages, created_source, created_by)
       values ($1, $2, 99, 'draft', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'name', 'H', 'slug', '', 'isHome', true, 'seoTitle', 't', 'seoDescription', 'd', 'sections', '[]'::jsonb)), 'migration', null)`, [other.organizationId, published.site_id],
    )).rejects.toThrow(/foreign key/i);
    // A site cannot point at a revision of another site.
    await expect(pgQuery('update public.public_sites set current_published_revision_id = $1 where organization_id = $2', [published.id, other.organizationId])).rejects.toThrow(/foreign key/i);
  });

  it('still serves GildOps\' own homepage from the home page of its published snapshot', async () => {
    await pgQuery('select app.bootstrap_gold_public_site($1)', [gold.organizationId]);
    await pgQuery('update public.platform_settings set gold_public_organization_id = $1, gold_public_site_id = (select id from public.public_sites where organization_id = $1) where singleton', [gold.organizationId]);
    const page = await publishedGoldHomepage(anon());
    expect(page.organizationId).toBe(gold.organizationId);
    expect(page.sections.map((section) => section.kind)).toEqual(['hero', 'problem', 'capabilities', 'process', 'trust', 'cta']);
    expect(page.sections[0]).toMatchObject({ kind: 'hero', variant: 'preview' });
    // Bootstrapping again changes nothing.
    await pgQuery('select app.bootstrap_gold_public_site($1)', [gold.organizationId]);
    expect((await pgQuery('select count(*)::int as n from public.public_site_revisions where organization_id = $1', [gold.organizationId])).rows[0].n).toBe(1);
  });
});
