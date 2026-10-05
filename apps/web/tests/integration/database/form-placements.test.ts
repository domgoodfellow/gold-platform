import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FormDefinition } from '@gold/schemas';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  createForm,
  formEditorState,
  formSubmissionCustomerCandidates,
  linkFormSubmissionCustomer,
  listFormSubmissions,
  listForms,
  publishFormRevision,
  saveFormDraft,
  setFormArchived,
} from '@/lib/domain/forms/forms';
import { publishedFormByKey, publishedHostnameForm, submitPublicFormByKey } from '@/lib/domain/forms/public-forms';
import { claimPortalInvite, createPortalInvite } from '@/lib/domain/portal/portal';
import { portalFormsAvailable, setPortalForm, submitPortalForm } from '@/lib/domain/portal/portal-forms';
import { createHomepageDraft, homepageEditorState, publishHomepageRevision, submitHomepageRevision, updateHomepageDraft } from '@/lib/domain/public-site/public-site';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A form is placed, not copied: the website names it, the portal lists it, a key or a hostname
 * opens it. Every placement is read through the form's own published revision, and the places that
 * authoritatively know something (the portal link knows the customer) say so, never the browser.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ZONE = 'forms-test.example';

type Tenant = { db: SupabaseClient; organizationId: string; slug: string };
let a: Tenant;
let b: Tenant;
let pg: Client;
let previousSettings: { gold_public_organization_id: string | null; gold_public_site_id: string | null };

const client = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = client();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Owner', timezone: 'America/Toronto', currency: 'CAD' });
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  await pg.query('update public.organizations set slug = $1 where id = $2', [slug, organizationId]);
  await setModuleEnabled(db, { organizationId, key: 'portal', enabled: true });
  return { db, organizationId, slug };
}

const FORM: FormDefinition = {
  title: 'Request a quote',
  submitLabel: 'Send',
  confirmation: { title: 'Thanks', message: '' },
  fields: [
    { id: 'name', type: 'short_text', label: 'Your name', required: true },
    { id: 'email', type: 'email', label: 'Email' },
  ],
};

async function publishedForm(tenant: Tenant, name: string, publish = true) {
  const { formId, revisionId } = await createForm(tenant.db, { organizationId: tenant.organizationId, name });
  await saveFormDraft(tenant.db, { organizationId: tenant.organizationId, revisionId, definition: FORM });
  if (publish) await publishFormRevision(tenant.db, { organizationId: tenant.organizationId, revisionId });
  const state = (await formEditorState(tenant.db, tenant.organizationId, formId))!;
  return { formId, revisionId, slug: state.form.slug, publicKey: state.form.publicKey };
}

async function homepageSections(tenant: Tenant) {
  await createHomepageDraft(tenant.db, tenant.organizationId);
  const state = (await homepageEditorState(tenant.db, tenant.organizationId))!;
  return { revisionId: state.working!.id, sections: state.working!.sections.filter((section) => section.kind !== 'form') as NonNullable<typeof state.working>['sections'], seoTitle: state.working!.seoTitle, seoDescription: state.working!.seoDescription };
}

function withForm(sections: Awaited<ReturnType<typeof homepageSections>>['sections'], formId: string) {
  return [...sections.slice(0, 5), { kind: 'form', heading: 'Ask us', body: 'We reply fast.', formId }, ...sections.slice(5)] as never;
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Supabase test keys must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  await pg.query('update public.platform_settings set platform_public_domain = $1 where singleton', [ZONE]);
  a = await newTenant('placea');
  b = await newTenant('placeb');
  // A tenant has no website of its own until one is configured for it; this gives `a` the one the
  // platform bootstrap gives GildOps, and puts the platform setting back afterwards.
  previousSettings = (await pg.query('select gold_public_organization_id, gold_public_site_id from public.platform_settings where singleton')).rows[0];
  await pg.query('select app.bootstrap_gold_public_site($1)', [a.organizationId]);
}, 60_000);

afterAll(async () => {
  await pg.query('update public.platform_settings set platform_public_domain = null, gold_public_organization_id = $1, gold_public_site_id = $2 where singleton', [previousSettings.gold_public_organization_id, previousSettings.gold_public_site_id]);
  await pg?.end();
});

describe('website placement', () => {
  it('names a form by id, validates the reference, and never carries the definition', async () => {
    const form = await publishedForm(a, 'Website form');
    const draft = await homepageSections(a);

    await updateHomepageDraft(a.db, { organizationId: a.organizationId, revisionId: draft.revisionId, seoTitle: draft.seoTitle, seoDescription: draft.seoDescription, sections: withForm(draft.sections, form.formId) });
    const stored = (await pg.query('select sections from public.public_page_revisions where id = $1', [draft.revisionId])).rows[0].sections;
    expect(stored[5]).toEqual({ kind: 'form', heading: 'Ask us', body: 'We reply fast.', formId: form.formId });
    expect(JSON.stringify(stored)).not.toContain('Your name');
  });

  it('refuses a form that is another business\'s, a malformed section and a second form section', async () => {
    const foreign = await publishedForm(b, 'Their form');
    const draft = await homepageSections(a);
    const attempt = (sections: unknown) => a.db.rpc('update_public_homepage_draft', {
      p_organization_id: a.organizationId, p_revision_id: draft.revisionId, p_seo_title: draft.seoTitle, p_seo_description: draft.seoDescription, p_sections: sections as never,
    });
    expect((await attempt(withForm(draft.sections, foreign.formId))).error?.code).toBe('23503');
    expect((await attempt(withForm(draft.sections, randomUUID()))).error?.code).toBe('23503');

    const own = await publishedForm(a, 'Own form');
    const good = withForm(draft.sections, own.formId) as unknown[];
    expect((await attempt([...good.slice(0, 5), { ...(good[5] as object), html: '<b>x</b>' }, ...good.slice(6)])).error?.code).toBe('23514');
    expect((await attempt([...good.slice(0, 5), good[5], good[5], ...good.slice(6)])).error?.code).toBe('23514');
    expect((await attempt([...(good as unknown[]).slice(0, 4), good[5], good[4], good[6]])).error?.code).toBe('23514');
  });

  it('serves the form through the website from the form\'s published revision, and only once it is published', async () => {
    const unpublished = await publishedForm(a, 'Not yet', false);
    const draft = await homepageSections(a);
    await updateHomepageDraft(a.db, { organizationId: a.organizationId, revisionId: draft.revisionId, seoTitle: draft.seoTitle, seoDescription: draft.seoDescription, sections: withForm(draft.sections, unpublished.formId) });
    await submitHomepageRevision(a.db, a.organizationId, draft.revisionId);
    await publishHomepageRevision(a.db, a.organizationId, draft.revisionId);

    const host = `${a.slug}.${ZONE}`;
    const read = async () => (await client().rpc('published_hostname_site', { p_hostname: host })).data as { home: { forms: Record<string, { definition: { title: string }; revisionNumber: number }>; sections: unknown[] } };
    expect(Object.keys((await read()).home.forms)).toEqual([]);

    // The form is published afterwards: the website is not re-published, and now shows it.
    const state = (await formEditorState(a.db, a.organizationId, unpublished.formId))!;
    await publishFormRevision(a.db, { organizationId: a.organizationId, revisionId: state.working!.id });
    const after = await read();
    expect(after.home.forms[unpublished.formId].definition.title).toBe('Request a quote');
    expect(after.home.forms[unpublished.formId].revisionNumber).toBe(1);
    expect(after.home.sections).toHaveLength(7);

    // The form changes: the website's revision does not, and the page now shows the new revision.
    const draftForm = (await a.db.rpc('create_form_draft', { p_organization_id: a.organizationId, p_form_id: unpublished.formId })).data as string;
    await saveFormDraft(a.db, { organizationId: a.organizationId, revisionId: draftForm, definition: { ...FORM, title: 'Get a price' } });
    await publishFormRevision(a.db, { organizationId: a.organizationId, revisionId: draftForm });
    const changed = await read();
    expect(changed.home.forms[unpublished.formId].definition.title).toBe('Get a price');
    const sectionsNow = (await pg.query('select sections from public.public_page_revisions where id = $1', [draft.revisionId])).rows[0].sections;
    expect(JSON.stringify(sectionsNow)).not.toContain('Get a price');
  });

  it('says where a form is used, and will not archive one a live page still shows', async () => {
    const forms = await listForms(a.db, a.organizationId);
    const onSite = forms.find((form) => form.name === 'Not yet')!;
    expect(onSite.placements.websitePublished).toBe(true);
    await expect(setFormArchived(a.db, { organizationId: a.organizationId, formId: onSite.id, archived: true })).rejects.toThrow(/still used by the website/);
    const free = forms.find((form) => form.name === 'Own form')!;
    expect(free.placements).toEqual({ websitePublished: false, websiteDraft: false, portal: false, booking: false });
  });
});

describe('hostname and key addresses', () => {
  it('opens a form at the business hostname by slug, and nowhere else', async () => {
    const form = await publishedForm(a, 'Hostname form');
    const host = `${a.slug}.${ZONE}`;
    const found = await publishedHostnameForm(client(), host, form.slug);
    expect(found?.formId).toBe(form.formId);
    expect(await publishedHostnameForm(client(), `${b.slug}.${ZONE}`, form.slug)).toBeNull();
    expect(await publishedHostnameForm(client(), `nobody-${randomUUID().slice(0, 6)}.${ZONE}`, form.slug)).toBeNull();
    expect(await publishedHostnameForm(client(), 'localhost', form.slug)).toBeNull();
  });

  it('keeps a form\'s key working when the business renames itself', async () => {
    const form = await publishedForm(a, 'Rename survivor');
    const before = await publishedFormByKey(client(), form.publicKey);
    expect(before?.formId).toBe(form.formId);
    const oldSlug = a.slug;
    const newSlug = `${oldSlug}-renamed`;
    await pg.query('update public.organizations set slug = $1 where id = $2', [newSlug, a.organizationId]);
    try {
      expect((await publishedFormByKey(client(), form.publicKey))?.formId).toBe(form.formId);
      expect((await client().rpc('published_form', { p_organization_slug: oldSlug, p_form_slug: form.slug })).data).toBeNull();
    } finally {
      await pg.query('update public.organizations set slug = $1 where id = $2', [oldSlug, a.organizationId]);
    }
  });
});

describe('portal placement', () => {
  it('derives the customer from the portal link: the form carries no identity and a response lands on the right customer', async () => {
    const form = await publishedForm(a, 'Portal form');
    const ariane = await createCustomer(a.db, { organizationId: a.organizationId, name: 'Ariane' });
    const bastien = await createCustomer(a.db, { organizationId: a.organizationId, name: 'Bastien' });
    await setPortalForm(a.db, { organizationId: a.organizationId, formId: form.formId, enabled: true });

    const arianePortal = client();
    await claimPortalInvite(arianePortal, { token: await createPortalInvite(a.db, { customerId: ariane }) });
    const bastienPortal = client();
    await claimPortalInvite(bastienPortal, { token: await createPortalInvite(a.db, { customerId: bastien }) });

    expect((await portalFormsAvailable(arianePortal)).map((entry) => entry.formId)).toEqual([form.formId]);
    // Whatever a form says about who it is, the response is Ariane's, and says it came from the portal.
    expect(await submitPortalForm(arianePortal, { formId: form.formId, answers: { name: 'Not Ariane', customer_id: bastien } })).toMatchObject({ ok: false });
    expect(await submitPortalForm(arianePortal, { formId: form.formId, answers: { name: 'Ariane B' } })).toEqual({ ok: true });
    expect(await submitPortalForm(bastienPortal, { formId: form.formId, answers: { name: 'Bastien C' } })).toEqual({ ok: true });

    const read = (await listFormSubmissions(a.db, a.organizationId, form.formId))!;
    const byName = Object.fromEntries(read.submissions.map((entry) => [entry.answers.name as string, entry]));
    expect(byName['Ariane B']).toMatchObject({ source: 'portal', customerId: ariane, customerName: 'Ariane' });
    expect(byName['Bastien C']).toMatchObject({ source: 'portal', customerId: bastien });
  });

  it('offers nothing to somebody with no portal binding, and will not take their response', async () => {
    const form = await publishedForm(a, 'Portal only');
    await setPortalForm(a.db, { organizationId: a.organizationId, formId: form.formId, enabled: true });
    const stranger = client();
    await stranger.auth.signInAnonymously();
    expect(await portalFormsAvailable(stranger)).toEqual([]);
    const live = (await publishedFormByKey(client(), form.publicKey))!;
    const { error } = await stranger.rpc('submit_portal_form', { p_form_id: form.formId, p_revision_id: live.revisionId, p_answers: { name: 'x' } });
    expect(error?.code).toBe('42501');
  });

  it('offers only forms the business chose, and only its own', async () => {
    const chosen = await publishedForm(a, 'Chosen');
    const notChosen = await publishedForm(a, 'Not chosen');
    const theirs = await publishedForm(b, 'Theirs in portal');
    await setPortalForm(a.db, { organizationId: a.organizationId, formId: chosen.formId, enabled: true });
    await setPortalForm(b.db, { organizationId: b.organizationId, formId: theirs.formId, enabled: true });
    const customer = await createCustomer(a.db, { organizationId: a.organizationId, name: 'Chooser' });
    const portal = client();
    await claimPortalInvite(portal, { token: await createPortalInvite(a.db, { customerId: customer }) });
    const offered = (await portalFormsAvailable(portal)).map((entry) => entry.formId);
    expect(offered).toContain(chosen.formId);
    expect(offered).not.toContain(notChosen.formId);
    expect(offered).not.toContain(theirs.formId);
    expect(await submitPortalForm(portal, { formId: notChosen.formId, answers: { name: 'x' } })).toMatchObject({ ok: false });
    // The business cannot offer another business's form, or have it offered by somebody else.
    await expect(setPortalForm(a.db, { organizationId: a.organizationId, formId: theirs.formId, enabled: true })).rejects.toThrow();
    await expect(setPortalForm(b.db, { organizationId: a.organizationId, formId: chosen.formId, enabled: false })).rejects.toThrow(/cannot manage/);
  });

  it('will not archive a form the portal offers', async () => {
    const form = await publishedForm(a, 'Offered then archived');
    await setPortalForm(a.db, { organizationId: a.organizationId, formId: form.formId, enabled: true });
    await expect(setFormArchived(a.db, { organizationId: a.organizationId, formId: form.formId, archived: true })).rejects.toThrow(/still used by the portal/);
    await setPortalForm(a.db, { organizationId: a.organizationId, formId: form.formId, enabled: false });
    await setFormArchived(a.db, { organizationId: a.organizationId, formId: form.formId, archived: true });
  });
});

describe('responses and customers', () => {
  it('offers customers by CRM\'s own matching rule, links only on a person\'s say-so, and not across businesses', async () => {
    const form = await publishedForm(a, 'Customer link');
    const customerId = await createCustomer(a.db, { organizationId: a.organizationId, name: 'Match Me', email: 'Match.Me@Example.com' });
    const foreign = await createCustomer(b.db, { organizationId: b.organizationId, name: 'Same Email', email: 'match.me@example.com' });

    expect(await submitPublicFormByKey(client(), { publicKey: form.publicKey, revisionId: (await publishedFormByKey(client(), form.publicKey))!.revisionId, answers: { name: 'Visitor', email: 'match.me@example.com' }, source: 'website' })).toEqual({ ok: true });
    const response = (await listFormSubmissions(a.db, a.organizationId, form.formId))!.submissions[0];
    expect(response).toMatchObject({ source: 'website', customerId: null });

    expect((await formSubmissionCustomerCandidates(a.db, a.organizationId, response.id)).map((candidate) => candidate.id)).toEqual([customerId]);
    await expect(linkFormSubmissionCustomer(a.db, { organizationId: a.organizationId, submissionId: response.id, customerId: foreign })).rejects.toThrow(/does not exist/);
    await linkFormSubmissionCustomer(a.db, { organizationId: a.organizationId, submissionId: response.id, customerId });
    expect((await listFormSubmissions(a.db, a.organizationId, form.formId))!.submissions[0]).toMatchObject({ customerId, customerName: 'Match Me' });
    await linkFormSubmissionCustomer(a.db, { organizationId: a.organizationId, submissionId: response.id, customerId: null });
    // Another business can neither read nor link it.
    await expect(formSubmissionCustomerCandidates(b.db, a.organizationId, response.id)).rejects.toThrow(/cannot manage/);
    await expect(linkFormSubmissionCustomer(b.db, { organizationId: b.organizationId, submissionId: response.id, customerId: foreign })).rejects.toThrow(/does not exist/);
  });

  it('keeps a response when its customer is deleted, and does not rewrite a portal response\'s customer', async () => {
    const form = await publishedForm(a, 'Customer deleted');
    const customerId = await createCustomer(a.db, { organizationId: a.organizationId, name: 'Soon Gone' });
    const portal = client();
    await setPortalForm(a.db, { organizationId: a.organizationId, formId: form.formId, enabled: true });
    await claimPortalInvite(portal, { token: await createPortalInvite(a.db, { customerId }) });
    await submitPortalForm(portal, { formId: form.formId, answers: { name: 'Gone' } });
    const response = (await listFormSubmissions(a.db, a.organizationId, form.formId))!.submissions[0];
    const other = await createCustomer(a.db, { organizationId: a.organizationId, name: 'Other' });
    await expect(linkFormSubmissionCustomer(a.db, { organizationId: a.organizationId, submissionId: response.id, customerId: other })).rejects.toThrow(/portal response/);
    await pg.query('delete from public.customers where id = $1', [customerId]).catch(() => undefined);
    const after = (await listFormSubmissions(a.db, a.organizationId, form.formId))!;
    expect(after.total).toBe(1);
  });
});

describe('a public write never ends a session it did not begin', () => {
  it('leaves a signed-in business owner signed in after submitting their own form', async () => {
    const form = await publishedForm(a, 'Owner tries it');
    const live = (await publishedFormByKey(client(), form.publicKey))!;
    const before = (await a.db.auth.getUser()).data.user?.id;
    expect(before).toBeTruthy();
    const result = await submitPublicFormByKey(a.db, { publicKey: form.publicKey, revisionId: live.revisionId, answers: { name: 'Me' }, source: 'hosted' });
    expect(result).toEqual({ ok: true });
    expect((await a.db.auth.getUser()).data.user?.id).toBe(before);
    // And Studio still reads: the session was not revoked.
    expect((await formEditorState(a.db, a.organizationId, form.formId))?.form.id).toBe(form.formId);
  });
});
