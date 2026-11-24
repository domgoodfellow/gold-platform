import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import {
  createSiteDraft, createWebsite, discardSiteDraft, publishSiteRevision, siteEditorState, sitePreview,
  siteRevisionContext, submitSiteRevision, updateSiteDraft,
} from '@/lib/domain/public-site/public-site';
import { DomainError } from '@/lib/domain/errors';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A website draft knows what it was started from (20261124000001). The production case this
 * reproduces: GildOps' Studio draft opened from one homepage, then newer homepages published by
 * migrations around it, with no way to discard the draft and no protection against publishing it.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; organizationId: string; email: string };
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
  return { ...account, organizationId };
}

async function pgQuery(text: string, values: unknown[] = []) {
  const pg = new Client(CONNECTION); await pg.connect();
  try { return await pg.query(text, values); } finally { await pg.end(); }
}

const revisionCount = async (t: Tenant) =>
  (await pgQuery('select count(*)::int as n from public.public_site_revisions where organization_id = $1', [t.organizationId])).rows[0].n as number;

const homeHeading = (pages: { isHome: boolean; sections: { heading?: string }[] }[]) => pages.find((page) => page.isHome)!.sections[0]?.heading;

/** What 20261108000001 – 20261109000004 did to GildOps' site: archive the published homepage and publish a new one, without touching any draft. */
async function publishByMigration(t: Tenant, heading: string) {
  await pgQuery(`
    with current_revision as (
      select r.* from public.public_site_revisions r
      join public.public_sites s on s.organization_id = r.organization_id and s.current_published_revision_id = r.id
      where s.organization_id = $1
    ), archived as (
      update public.public_site_revisions r set status = 'archived', archived_at = now()
      from current_revision c where r.organization_id = c.organization_id and r.id = c.id returning r.id
    ), inserted as (
      insert into public.public_site_revisions (organization_id, site_id, revision_number, status, pages, navigation, created_source, submitted_at, published_at)
      select c.organization_id, c.site_id,
             (select max(revision_number) + 1 from public.public_site_revisions where organization_id = c.organization_id and site_id = c.site_id),
             'published',
             (select jsonb_agg(case when (p ->> 'isHome')::boolean then jsonb_set(p, '{sections,0,heading}', to_jsonb($2::text)) else p end) from jsonb_array_elements(c.pages) p),
             c.navigation, 'migration', now(), now()
      from current_revision c, archived returning id, organization_id, site_id
    )
    update public.public_sites s set current_published_revision_id = i.id from inserted i
     where s.organization_id = i.organization_id and s.id = i.site_id`, [t.organizationId, heading]);
}

/** A business with one published revision whose homepage starts with a hero headed `heading`. */
async function publishedSite(label: string, heading = 'First'): Promise<Tenant> {
  const t = await newTenant(label);
  await createWebsite(t.db, { organizationId: t.organizationId, templateKey: 'simple_brochure' });
  const state = (await siteEditorState(t.db, t.organizationId))!;
  const pages = state.working!.pages.map((page) => (page.isHome ? { ...page, sections: page.sections.map((section, index) => (index === 0 ? { ...section, heading } : section)) } : page));
  await updateSiteDraft(t.db, { organizationId: t.organizationId, revisionId: state.working!.id, content: { pages, navigation: state.working!.navigation } });
  await submitSiteRevision(t.db, t.organizationId, state.working!.id);
  await publishSiteRevision(t.db, t.organizationId, state.working!.id);
  return t;
}

describe('website drafts know their base, can be discarded, and cannot silently replace newer content', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Supabase test keys must be set.');
    previousSettings = (await pgQuery('select gold_public_organization_id, gold_public_site_id from public.platform_settings where singleton')).rows[0];
  }, 60_000);

  afterAll(async () => {
    await pgQuery('update public.platform_settings set gold_public_organization_id = $1, gold_public_site_id = $2 where singleton', [previousSettings.gold_public_organization_id, previousSettings.gold_public_site_id]);
  });

  it('creates no revision by reading the editor, history, a preview or a revision\'s standing', async () => {
    const t = await publishedSite('drafts-read');
    const before = await revisionCount(t);
    const state = (await siteEditorState(t.db, t.organizationId))!;
    await sitePreview(t.db, { organizationId: t.organizationId, revisionId: state.published!.id });
    await siteRevisionContext(t.db, { organizationId: t.organizationId, revisionId: state.published!.id });
    await siteEditorState(t.db, t.organizationId);
    expect(state.working).toBeNull();
    expect(await revisionCount(t)).toBe(before);
  });

  it('records the base of a new draft and marks it stale once something newer is published', async () => {
    const t = await publishedSite('drafts-base', 'One');
    const draftId = await createSiteDraft(t.db, { organizationId: t.organizationId });
    let state = (await siteEditorState(t.db, t.organizationId))!;
    expect(state.working).toMatchObject({ id: draftId, baseRevisionId: state.published!.id, copiedFromRevisionId: state.published!.id, stale: false });

    await publishByMigration(t, 'Two');
    state = (await siteEditorState(t.db, t.organizationId))!;
    expect(state.working!.stale).toBe(true);
    expect(state.working!.baseRevisionNumber).toBe(1);
    expect(state.published!.number).toBe(3);
    expect(state.published!.createdSource).toBe('migration');
    const context = await siteRevisionContext(t.db, { organizationId: t.organizationId, revisionId: draftId });
    expect(context).toMatchObject({ stale: true, status: 'draft', publishedRevisionNumber: 3, experience: 'organization_website' });
  });

  it('treats a draft from before bases were recorded as stale when anything was published after it was opened', async () => {
    const t = await publishedSite('drafts-legacy', 'Old');
    const draftId = await createSiteDraft(t.db, { organizationId: t.organizationId });
    // As every draft before 20261124000001: no base, no copy source, opened well before.
    await pgQuery(`update public.public_site_revisions set base_revision_id = null, copied_from_revision_id = null, created_at = now() - interval '60 days' where id = $1`, [draftId]);
    // ...after the homepage it copied was published (a published row's content is fixed, not its dates).
    await pgQuery(`update public.public_site_revisions set published_at = now() - interval '90 days', submitted_at = now() - interval '90 days' where organization_id = $1 and status = 'published'`, [t.organizationId]);
    expect((await siteEditorState(t.db, t.organizationId))!.working!.stale).toBe(false);
    await publishByMigration(t, 'Newer');
    expect((await siteEditorState(t.db, t.organizationId))!.working!.stale).toBe(true);
  });

  it('refuses to publish a stale revision unless the person confirms replacing the newer one', async () => {
    const t = await publishedSite('drafts-guard', 'Base');
    const draftId = await createSiteDraft(t.db, { organizationId: t.organizationId });
    await publishByMigration(t, 'Newer');
    await submitSiteRevision(t.db, t.organizationId, draftId);

    const refusal = await publishSiteRevision(t.db, t.organizationId, draftId).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(DomainError);
    expect((refusal as DomainError).code).toBe('public_site.stale');
    expect((refusal as DomainError).message).toMatch(/revision \d+ was started before revision 3 was published/);
    let state = (await siteEditorState(t.db, t.organizationId))!;
    expect(homeHeading(state.published!.pages)).toBe('Newer');

    await publishSiteRevision(t.db, t.organizationId, draftId, { replaceNewer: true });
    state = (await siteEditorState(t.db, t.organizationId))!;
    expect(state.published!.id).toBe(draftId);
    expect(homeHeading(state.published!.pages)).toBe('Base');
    const event = (await pgQuery(`select payload from public.events where organization_id = $1 and entity_id = $2 and action = 'public_site.published'`, [t.organizationId, draftId])).rows[0];
    expect(event.payload.replaced_newer).toBe(true);
  });

  it('publishes a current draft without asking', async () => {
    const t = await publishedSite('drafts-current');
    const draftId = await createSiteDraft(t.db, { organizationId: t.organizationId });
    await submitSiteRevision(t.db, t.organizationId, draftId);
    await publishSiteRevision(t.db, t.organizationId, draftId);
    expect((await siteEditorState(t.db, t.organizationId))!.published!.id).toBe(draftId);
  });

  it('discards a stale persisted draft, keeping the published revision and the record of the draft', async () => {
    const t = await publishedSite('drafts-discard', 'Base');
    const draftId = await createSiteDraft(t.db, { organizationId: t.organizationId });
    await publishByMigration(t, 'Live');
    const published = (await siteEditorState(t.db, t.organizationId))!.published!;

    await discardSiteDraft(t.db, t.organizationId, draftId);

    const state = (await siteEditorState(t.db, t.organizationId))!;
    expect(state.working).toBeNull();
    expect(state.published!.id).toBe(published.id);
    expect(homeHeading(state.published!.pages)).toBe('Live');
    expect(state.history.find((entry) => entry.id === draftId)).toMatchObject({ status: 'discarded' });
    expect(state.history.find((entry) => entry.id === draftId)!.discardedAt).toBeTruthy();
    const event = (await pgQuery(`select actor_id, payload from public.events where organization_id = $1 and entity_id = $2 and action = 'public_site.draft_discarded'`, [t.organizationId, draftId])).rows[0];
    expect(event.payload).toMatchObject({ previous_status: 'draft', was_stale: true, published_revision_id: published.id });
    expect(event.actor_id).toBeTruthy();

    // The discarded draft is a fixed record: not editable, not deletable, not discarded twice.
    await expect(pgQuery(`update public.public_site_revisions set status = 'draft', discarded_at = null, discarded_by = null where id = $1`, [draftId])).rejects.toThrow(/fixed record|lifecycle/i);
    await expect(pgQuery('delete from public.public_site_revisions where id = $1', [draftId])).rejects.toThrow(/immutable/i);
    await expect(updateSiteDraft(t.db, { organizationId: t.organizationId, revisionId: draftId, content: { pages: published.pages, navigation: published.navigation } })).rejects.toThrow(/only a draft/i);
    await expect(discardSiteDraft(t.db, t.organizationId, draftId)).rejects.toThrow(/only a working draft/i);
    // The published revision cannot be discarded.
    await expect(discardSiteDraft(t.db, t.organizationId, published.id)).rejects.toThrow(/only a working draft/i);
  });

  it('discards a revision in review too', async () => {
    const t = await publishedSite('drafts-review');
    const draftId = await createSiteDraft(t.db, { organizationId: t.organizationId });
    await submitSiteRevision(t.db, t.organizationId, draftId);
    await discardSiteDraft(t.db, t.organizationId, draftId);
    expect((await siteEditorState(t.db, t.organizationId))!.working).toBeNull();
  });

  it('restores an archived or discarded revision as a new draft based on the current published one', async () => {
    const t = await publishedSite('drafts-restore', 'Original');
    const archivedId = (await siteEditorState(t.db, t.organizationId))!.published!.id;
    await publishByMigration(t, 'Current');
    const discardedId = await createSiteDraft(t.db, { organizationId: t.organizationId });
    const discardedPages = (await siteEditorState(t.db, t.organizationId))!.working!.pages;
    await discardSiteDraft(t.db, t.organizationId, discardedId);

    const restored = await createSiteDraft(t.db, { organizationId: t.organizationId, fromRevisionId: archivedId });
    let state = (await siteEditorState(t.db, t.organizationId))!;
    expect(state.working).toMatchObject({ id: restored, copiedFromRevisionId: archivedId, baseRevisionId: state.published!.id, stale: false });
    expect(homeHeading(state.working!.pages)).toBe('Original');
    expect(homeHeading(state.published!.pages)).toBe('Current');
    const event = (await pgQuery(`select payload from public.events where organization_id = $1 and entity_id = $2 and action = 'public_site.restored'`, [t.organizationId, restored])).rows[0];
    expect(event.payload.copied_from).toBe(archivedId);

    // With a draft open, restoring is refused rather than silently returning the open draft.
    await expect(createSiteDraft(t.db, { organizationId: t.organizationId, fromRevisionId: discardedId })).rejects.toThrow(/discard it before restoring/i);

    await discardSiteDraft(t.db, t.organizationId, restored);
    await createSiteDraft(t.db, { organizationId: t.organizationId, fromRevisionId: discardedId });
    state = (await siteEditorState(t.db, t.organizationId))!;
    expect(state.working!.pages).toEqual(discardedPages);
  });

  it('keeps discarding, restoring and reading revision standing to the business and its managers', async () => {
    const t = await publishedSite('drafts-owner');
    const other = await publishedSite('drafts-other');
    const draftId = await createSiteDraft(t.db, { organizationId: t.organizationId });

    await expect(discardSiteDraft(other.db, t.organizationId, draftId)).rejects.toThrow(/insufficient privilege/i);
    // Its own organization id with another business's revision: nothing to discard.
    await expect(discardSiteDraft(other.db, other.organizationId, draftId)).rejects.toThrow(/only a working draft/i);
    await expect(siteRevisionContext(other.db, { organizationId: t.organizationId, revisionId: draftId })).rejects.toThrow(/insufficient privilege/i);
    expect((await other.db.rpc('public_site_revision_context', { p_organization_id: other.organizationId, p_revision_id: draftId })).data).toBeNull();

    const viewer = await signUp('drafts-viewer');
    const roleId = await createRole(t.db, { organizationId: t.organizationId, name: 'Viewer', capabilities: [] });
    await addMember(t.db, { organizationId: t.organizationId, email: viewer.email, displayName: 'Viewer', roleId });
    await expect(discardSiteDraft(viewer.db, t.organizationId, draftId)).rejects.toThrow(/insufficient privilege/i);
    await expect(publishSiteRevision(viewer.db, t.organizationId, draftId, { replaceNewer: true })).rejects.toThrow(/insufficient privilege/i);

    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    expect((await anon.rpc('discard_public_site_draft', { p_organization_id: t.organizationId, p_revision_id: draftId })).error).toBeTruthy();
    expect((await siteEditorState(t.db, t.organizationId))!.working!.id).toBe(draftId);
  });

  it('names GildOps\' own site as the marketing experience and every other as a business website', async () => {
    const gold = await publishedSite('drafts-gold');
    const tenant = await publishedSite('drafts-tenant');
    await pgQuery('update public.platform_settings set gold_public_organization_id = $1, gold_public_site_id = (select id from public.public_sites where organization_id = $1) where singleton', [gold.organizationId]);
    expect((await siteEditorState(gold.db, gold.organizationId))!.experience).toBe('gildops_marketing');
    expect((await siteEditorState(tenant.db, tenant.organizationId))!.experience).toBe('organization_website');
    const published = (await siteEditorState(gold.db, gold.organizationId))!.published!;
    expect((await siteRevisionContext(gold.db, { organizationId: gold.organizationId, revisionId: published.id })).experience).toBe('gildops_marketing');
  });
});
