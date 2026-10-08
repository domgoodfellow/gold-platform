import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FormDefinition } from '@gold/schemas';
import {
  createForm,
  createFormDraft,
  formEditorState,
  formSubmissionPage,
  readFormRevision,
  listFormSubmissions,
  listFormTemplates,
  listForms,
  publishFormRevision,
  saveFormDraft,
  setFormArchived,
} from '@/lib/domain/forms/forms';
import { publishedForm, submitPublicForm } from '@/lib/domain/forms/public-forms';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Forms against the real database: a form is a stable identity, a revision is one immutable
 * definition, and a submission names the exact revision it was answered under. Two real
 * businesses and a real anonymous visitor, so a policy or a function that trusted a supplied id
 * would be caught here rather than described.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; organizationId: string; slug: string };
let a: Tenant;
let b: Tenant;

async function pgQuery(text: string, values: unknown[] = []) {
  const pg = new Client(CONNECTION);
  await pg.connect();
  try { return await pg.query(text, values); } finally { await pg.end(); }
}

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Owner', timezone: 'America/Toronto', currency: 'CAD' });
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  await pgQuery('update public.organizations set slug = $1 where id = $2', [slug, organizationId]);
  return { db, organizationId, slug };
}

/** A visitor: no account, no membership, only the anonymous session the public door gives them. */
function visitor() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

const QUOTE: FormDefinition = {
  title: 'Request a quote',
  submitLabel: 'Send',
  confirmation: { title: 'Thanks', message: 'We will be in touch.' },
  fields: [
    { id: 'name', type: 'short_text', label: 'Your name', required: true },
    { id: 'vehicle_type', type: 'select', label: 'What type of vehicle do you have?', options: [{ value: 'car', label: 'Car' }, { value: 'van', label: 'Van' }] },
  ],
};

async function publishedQuote(tenant: Tenant, name = 'Quote') {
  const { formId, revisionId } = await createForm(tenant.db, { organizationId: tenant.organizationId, name });
  await saveFormDraft(tenant.db, { organizationId: tenant.organizationId, revisionId, definition: QUOTE });
  await publishFormRevision(tenant.db, { organizationId: tenant.organizationId, revisionId });
  const state = await formEditorState(tenant.db, tenant.organizationId, formId);
  return { formId, revisionId, slug: state!.form.slug, publicKey: state!.form.publicKey };
}

describe('forms', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('Supabase test keys must be set.');
    a = await newTenant('forms-a');
    b = await newTenant('forms-b');
  });

  afterAll(async () => {
    await Promise.all([a, b].map((tenant) => tenant?.db.auth.signOut()));
  });

  it('pages every response deterministically and keeps historical definitions and tenant authorization', async () => {
    const { formId, revisionId } = await publishedQuote(a, 'Paged responses');
    const user = (await a.db.auth.getUser()).data.user!;
    await pgQuery(`insert into public.form_submissions (organization_id, form_id, form_revision_id, submitted_by, answers)
      select $1, $2, $3, $4, jsonb_build_object('name', 'Respondent ' || n) from generate_series(1,55) n`,
    [a.organizationId, formId, revisionId, user.id]);
    const draftId = await createFormDraft(a.db, a.organizationId, formId);
    await saveFormDraft(a.db, { organizationId: a.organizationId, revisionId: draftId, definition: { ...QUOTE, fields: [{ id: 'name', type: 'short_text', label: 'Renamed question' }] } });
    await publishFormRevision(a.db, { organizationId: a.organizationId, revisionId: draftId });
    const first = (await formSubmissionPage(a.db, a.organizationId, formId, 0))!;
    const second = (await formSubmissionPage(a.db, a.organizationId, formId, 50))!;
    expect(first.total).toBe(55);
    expect(first.submissions).toHaveLength(50);
    expect(second.submissions).toHaveLength(5);
    expect(new Set([...first.submissions, ...second.submissions].map((row) => row.id)).size).toBe(55);
    expect(first.revisions[0].definition.fields[0].label).toBe('Your name');
    expect(second.revisions[0].id).toBe(revisionId);
    expect((await readFormRevision(a.db, a.organizationId, formId, revisionId))?.definition.fields[0].label).toBe('Your name');
    await expect(readFormRevision(b.db, a.organizationId, formId, revisionId)).rejects.toThrow();
    expect(await readFormRevision(b.db, b.organizationId, formId, revisionId)).toBeNull();
    await expect(formSubmissionPage(b.db, a.organizationId, formId, 0)).rejects.toThrow();
    expect(await formSubmissionPage(b.db, b.organizationId, formId, 0)).toBeNull();
  });

  describe('lifecycle', () => {
    it('creates a blank form with an empty draft that nobody can see publicly', async () => {
      const { formId } = await createForm(a.db, { organizationId: a.organizationId, name: 'Contact us' });
      const state = await formEditorState(a.db, a.organizationId, formId);
      expect(state?.working?.number).toBe(1);
      expect(state?.working?.definition.fields).toEqual([]);
      expect(state?.published).toBeNull();
      expect(await publishedForm(visitor(), a.slug, state!.form.slug)).toBeNull();
    });

    it('refuses to publish a form with no questions', async () => {
      const { revisionId } = await createForm(a.db, { organizationId: a.organizationId, name: 'Empty' });
      await expect(publishFormRevision(a.db, { organizationId: a.organizationId, revisionId })).rejects.toThrow(/at least one question/i);
    });

    it('serves only the published revision: a draft edit leaves the public form untouched until publish', async () => {
      const { formId, slug } = await publishedQuote(a, 'Journey C');
      expect((await publishedForm(visitor(), a.slug, slug))?.definition.title).toBe('Request a quote');

      const draftId = await createFormDraft(a.db, a.organizationId, formId);
      await saveFormDraft(a.db, { organizationId: a.organizationId, revisionId: draftId, definition: { ...QUOTE, title: 'Get a price' } });
      expect((await publishedForm(visitor(), a.slug, slug))?.definition.title).toBe('Request a quote');

      await publishFormRevision(a.db, { organizationId: a.organizationId, revisionId: draftId });
      const live = await publishedForm(visitor(), a.slug, slug);
      expect(live?.definition.title).toBe('Get a price');
      expect(live?.revisionNumber).toBe(2);

      const state = await formEditorState(a.db, a.organizationId, formId);
      expect(state?.history.map((entry) => [entry.number, entry.status])).toEqual([[2, 'published'], [1, 'archived']]);
    });

    it('holds a published revision immutable at the table, whoever writes', async () => {
      const { revisionId } = await publishedQuote(a, 'Immutable');
      await expect(pgQuery(`update public.form_revisions set definition = definition || '{"title":"Changed"}'::jsonb where id = $1`, [revisionId]))
        .rejects.toThrow(/immutable/);
    });

    it('allows at most one draft and one published revision per form, structurally', async () => {
      const { formId } = await publishedQuote(a, 'One of each');
      const draftId = await createFormDraft(a.db, a.organizationId, formId);
      expect(await createFormDraft(a.db, a.organizationId, formId)).toBe(draftId);
      await expect(pgQuery(
        `insert into public.form_revisions (organization_id, form_id, revision_number, status, definition, created_by)
         select organization_id, form_id, 99, 'draft', definition, created_by from public.form_revisions where id = $1`, [draftId],
      )).rejects.toThrow(/form_one_working_revision/);
    });

    it('does not accept an invalid definition from any writer', async () => {
      const { revisionId } = await createForm(a.db, { organizationId: a.organizationId, name: 'Strict' });
      const bad = { ...QUOTE, fields: [{ id: 'x', type: 'html', label: 'X' }] };
      const { error } = await a.db.rpc('save_form_draft', { p_organization_id: a.organizationId, p_revision_id: revisionId, p_definition: bad as never });
      expect(error?.code).toBe('23514');
      const dup = { ...QUOTE, fields: [QUOTE.fields[0], QUOTE.fields[0]] };
      const { error: dupError } = await a.db.rpc('save_form_draft', { p_organization_id: a.organizationId, p_revision_id: revisionId, p_definition: dup as never });
      expect(dupError?.code).toBe('23514');
    });

    it('takes an archived form off the public address and keeps its responses', async () => {
      const { formId, slug } = await publishedQuote(a, 'To archive');
      await submitPublicForm(visitor(), { organizationSlug: a.slug, formSlug: slug, revisionId: (await publishedForm(visitor(), a.slug, slug))!.revisionId, answers: { name: 'Ada' } });
      await setFormArchived(a.db, { organizationId: a.organizationId, formId, archived: true });
      expect(await publishedForm(visitor(), a.slug, slug)).toBeNull();
      expect((await listFormSubmissions(a.db, a.organizationId, formId))?.total).toBe(1);
      await setFormArchived(a.db, { organizationId: a.organizationId, formId, archived: false });
      expect(await publishedForm(visitor(), a.slug, slug)).not.toBeNull();
    });
  });

  describe('public submission', () => {
    it('persists against the exact revision submitted, and the answer survives a later change', async () => {
      const { formId, slug } = await publishedQuote(a, 'Journey A');
      const live = (await publishedForm(visitor(), a.slug, slug))!;
      const result = await submitPublicForm(visitor(), { organizationSlug: a.slug, formSlug: slug, revisionId: live.revisionId, answers: { name: ' Ada ', vehicle_type: 'van' } });
      expect(result).toEqual({ ok: true });

      // The form changes afterwards: the label is renamed and the field removed.
      const draftId = await createFormDraft(a.db, a.organizationId, formId);
      await saveFormDraft(a.db, { organizationId: a.organizationId, revisionId: draftId, definition: { ...QUOTE, fields: [{ id: 'name', type: 'short_text', label: 'Full name', required: true }] } });
      await publishFormRevision(a.db, { organizationId: a.organizationId, revisionId: draftId });

      const read = await listFormSubmissions(a.db, a.organizationId, formId);
      expect(read?.total).toBe(1);
      const submission = read!.submissions[0];
      expect(submission.answers).toEqual({ name: 'Ada', vehicle_type: 'van' });
      expect(submission.revisionId).toBe(live.revisionId);
      const revision = read!.revisions.find((entry) => entry.id === submission.revisionId)!;
      expect(revision.number).toBe(1);
      expect(revision.definition.fields.map((field) => field.label)).toEqual(['Your name', 'What type of vehicle do you have?']);
    });

    it('records form.submitted with ids only, never the answers', async () => {
      const { slug } = await publishedQuote(a, 'Event');
      const live = (await publishedForm(visitor(), a.slug, slug))!;
      await submitPublicForm(visitor(), { organizationSlug: a.slug, formSlug: slug, revisionId: live.revisionId, answers: { name: 'Grace' } });
      const { rows } = await pgQuery(`select payload from public.events where organization_id = $1 and action = 'form.submitted' order by occurred_at desc limit 1`, [a.organizationId]);
      expect(Object.keys(rows[0].payload).sort()).toEqual(['form_id', 'revision_id', 'revision_number', 'source']);
      expect(JSON.stringify(rows[0].payload)).not.toContain('Grace');
    });

    it('refuses an answer to a revision that is no longer the published one', async () => {
      const { formId, slug, publicKey } = await publishedQuote(a, 'Stale');
      const shown = (await publishedForm(visitor(), a.slug, slug))!;
      const draftId = await createFormDraft(a.db, a.organizationId, formId);
      await publishFormRevision(a.db, { organizationId: a.organizationId, revisionId: draftId });

      const attempt = visitor();
      await attempt.auth.signInAnonymously();
      const { error } = await attempt.rpc('submit_public_form_by_key', { p_public_key: publicKey, p_revision_id: shown.revisionId, p_answers: { name: 'Late' } });
      expect(error?.code).toBe('GD002');
      expect((await listFormSubmissions(a.db, a.organizationId, formId))?.total).toBe(0);
    });

    it('enforces required answers, choices and size in the database itself', async () => {
      const { slug, publicKey } = await publishedQuote(a, 'Strict answers');
      const live = (await publishedForm(visitor(), a.slug, slug))!;
      const attempt = visitor();
      await attempt.auth.signInAnonymously();
      const send = (answers: unknown) => attempt.rpc('submit_public_form_by_key', { p_public_key: publicKey, p_revision_id: live.revisionId, p_answers: answers as never });
      expect((await send({ vehicle_type: 'car' })).error?.code).toBe('23514');
      expect((await send({ name: 'x', vehicle_type: 'boat' })).error?.code).toBe('23514');
      expect((await send({ name: 'x', surprise: 'y' })).error?.code).toBe('23514');
      expect((await send({ name: 'x'.repeat(501) })).error?.code).toBe('23514');
      expect((await send('not an object')).error?.code).toBe('23514');
    });

    it('needs a session: a caller with none cannot write', async () => {
      const { slug, publicKey } = await publishedQuote(a, 'No session');
      const live = (await publishedForm(visitor(), a.slug, slug))!;
      const { error } = await visitor().rpc('submit_public_form_by_key', { p_public_key: publicKey, p_revision_id: live.revisionId, p_answers: { name: 'x' } });
      expect(error).not.toBeNull();
    });

    it('names the form by its key alone: an unknown key, a draft and a revision of another form all refuse', async () => {
      const own = await publishedQuote(a, 'Mine');
      const other = await publishedQuote(b, 'Theirs');
      const live = (await publishedForm(visitor(), a.slug, own.slug))!;
      const attempt = visitor();
      await attempt.auth.signInAnonymously();
      const send = (key: string, revision: string) => attempt.rpc('submit_public_form_by_key', { p_public_key: key, p_revision_id: revision, p_answers: { name: 'x' } });
      expect((await send('000000000000', live.revisionId)).error?.code).toBe('GD001');
      // A's revision under B's key is not B's published revision.
      expect((await send(other.publicKey, live.revisionId)).error?.code).toBe('GD002');
      const draft = await createForm(a.db, { organizationId: a.organizationId, name: 'Unpublished' });
      const draftKey = (await formEditorState(a.db, a.organizationId, draft.formId))!.form.publicKey;
      expect((await send(draftKey, draft.revisionId)).error?.code).toBe('GD001');
    });

    it('limits only the public sources: portal and booking are not claimable by a visitor', async () => {
      const { publicKey, slug } = await publishedQuote(a, 'Sources');
      const live = (await publishedForm(visitor(), a.slug, slug))!;
      const attempt = visitor();
      await attempt.auth.signInAnonymously();
      for (const source of ['portal', 'booking', 'anything']) {
        const { error } = await attempt.rpc('submit_public_form_by_key', { p_public_key: publicKey, p_revision_id: live.revisionId, p_answers: { name: 'x' }, p_source: source });
        expect(error?.code, source).toBe('22023');
      }
      for (const source of ['hosted', 'website', 'embed']) {
        const { error } = await attempt.rpc('submit_public_form_by_key', { p_public_key: publicKey, p_revision_id: live.revisionId, p_answers: { name: 'x' }, p_source: source });
        expect(error, source).toBeNull();
      }
    });

    it('stops a flood: a form takes a bounded number of responses a minute', async () => {
      const { publicKey, slug } = await publishedQuote(a, 'Flood');
      const live = (await publishedForm(visitor(), a.slug, slug))!;
      const attempt = visitor();
      await attempt.auth.signInAnonymously();
      let refused = 0;
      for (let i = 0; i < 32; i += 1) {
        const { error } = await attempt.rpc('submit_public_form_by_key', { p_public_key: publicKey, p_revision_id: live.revisionId, p_answers: { name: `n${i}` } });
        if (error?.code === 'GD003') refused += 1;
      }
      expect(refused).toBe(2);
    });
  });

  describe('tenant isolation', () => {
    it('lets neither business list, read, edit, publish or read responses of the other', async () => {
      const own = await publishedQuote(a, 'Private');
      expect((await listForms(b.db, b.organizationId)).map((form) => form.id)).not.toContain(own.formId);

      // B naming A's organization is refused outright.
      await expect(listForms(b.db, a.organizationId)).rejects.toThrow(/cannot manage forms/i);
      await expect(formEditorState(b.db, a.organizationId, own.formId)).rejects.toThrow(/cannot manage forms/i);
      await expect(listFormSubmissions(b.db, a.organizationId, own.formId)).rejects.toThrow(/cannot manage forms/i);
      await expect(publishFormRevision(b.db, { organizationId: a.organizationId, revisionId: own.revisionId })).rejects.toThrow();

      // B naming its own organization with A's ids finds nothing and changes nothing.
      expect(await formEditorState(b.db, b.organizationId, own.formId)).toBeNull();
      expect(await listFormSubmissions(b.db, b.organizationId, own.formId)).toBeNull();
      await expect(saveFormDraft(b.db, { organizationId: b.organizationId, revisionId: own.revisionId, definition: QUOTE })).rejects.toThrow(/only a draft/i);
      await expect(createFormDraft(b.db, b.organizationId, own.formId)).rejects.toThrow(/does not exist/i);
      await expect(setFormArchived(b.db, { organizationId: b.organizationId, formId: own.formId, archived: true })).rejects.toThrow(/does not exist/i);
    });

    it('grants no table to anybody: every read and write goes through a function', async () => {
      for (const table of ['forms', 'form_revisions', 'form_submissions', 'form_templates']) {
        const { error } = await a.db.from(table).select('*').limit(1);
        expect(error?.code, table).toBe('42501');
        const { error: anonError } = await visitor().from(table).select('*').limit(1);
        expect(anonError?.code, table).toBe('42501');
      }
    });

    it('does not let a visitor read a draft, a template or the editor', async () => {
      const { formId } = await createForm(a.db, { organizationId: a.organizationId, name: 'Hidden draft' });
      const anon = visitor();
      expect((await anon.rpc('list_form_templates')).error).not.toBeNull();
      expect((await anon.rpc('form_editor_state', { p_organization_id: a.organizationId, p_form_id: formId })).error).not.toBeNull();
    });
  });

  describe('templates', () => {
    it('offers the platform starters, each valid and publishable', async () => {
      const templates = await listFormTemplates(a.db);
      expect(templates.map((template) => template.key)).toEqual(expect.arrayContaining(['contact_us', 'request_a_quote', 'service_request', 'lead_intake', 'customer_feedback', 'general_inquiry']));
      for (const template of templates) expect(template.definition.fields.length).toBeGreaterThan(0);
    });

    it('creates an independent organization-owned form: changing the starter later changes nothing', async () => {
      const [quote] = (await listFormTemplates(a.db)).filter((template) => template.key === 'request_a_quote');
      const { formId } = await createForm(a.db, { organizationId: a.organizationId, name: 'Our quote form', templateKey: 'request_a_quote' });
      const before = await formEditorState(a.db, a.organizationId, formId);
      expect(before?.form.createdFromTemplateKey).toBe('request_a_quote');
      expect(before?.working?.definition).toEqual(quote.definition);

      await pgQuery(`update public.form_templates set definition = definition || '{"title":"Changed starter"}'::jsonb where key = 'request_a_quote'`);
      try {
        const after = await formEditorState(a.db, a.organizationId, formId);
        expect(after?.working?.definition.title).toBe(quote.definition.title);
        // The business can edit its own copy without touching the starter.
        await saveFormDraft(a.db, { organizationId: a.organizationId, revisionId: before!.working!.id, definition: { ...quote.definition, title: 'Ours' } });
        expect((await listFormTemplates(a.db)).find((template) => template.key === 'request_a_quote')?.definition.title).toBe('Changed starter');
      } finally {
        await pgQuery(`update public.form_templates set definition = definition || jsonb_build_object('title', $1::text) where key = 'request_a_quote'`, [quote.definition.title]);
      }
    });

    it('refuses an unknown template', async () => {
      await expect(createForm(a.db, { organizationId: a.organizationId, name: 'x', templateKey: 'nope' })).rejects.toThrow(/does not exist/);
    });
  });

  describe('public address', () => {
    it('gives two forms with one name different addresses, and never changes one on rename', async () => {
      const first = await createForm(a.db, { organizationId: a.organizationId, name: 'Same name' });
      const second = await createForm(a.db, { organizationId: a.organizationId, name: 'Same name' });
      const slugs = [first.formId, second.formId].map(async (id) => (await formEditorState(a.db, a.organizationId, id))!.form.slug);
      const [one, two] = await Promise.all(slugs);
      expect(one).not.toBe(two);
      const { error } = await a.db.rpc('rename_form', { p_organization_id: a.organizationId, p_form_id: first.formId, p_name: 'Renamed' });
      expect(error).toBeNull();
      expect((await formEditorState(a.db, a.organizationId, first.formId))!.form.slug).toBe(one);
    });
  });
});
