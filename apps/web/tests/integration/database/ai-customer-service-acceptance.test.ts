import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commandSupport } from '@/lib/domain/support/support';
import { createWebsite, publishSiteRevision, siteEditorState, submitSiteRevision, listSiteTemplates } from '@/lib/domain/public-site/public-site';
import { listCustomers } from '@/lib/domain/customers/customers';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The AI customer-service journey, stage by stage, with what is proven and what is not stated
 * plainly. Every step before the model and after it runs through the real authoritative
 * operations; the model step itself is the one thing that cannot run here.
 *
 * VERIFIED (real operations, real RLS): configuring and publishing an agent version, grounding it in
 * published knowledge only, deploying it to a published website, a stranger starting a conversation
 * with no account, the conversation being bound to the organization and the exact published
 * version, the assistant being refused once a human holds the conversation, the visitor asking for
 * a person, an operator claiming and answering it, and the other business being unable to touch it.
 *
 * NOT VERIFIED (no provider here): that a language model produces the reply. The AI's reply below
 * is written through the same machine-role door the runtime uses (`record_public_communication_reply`)
 * with a fixed sentence, so it proves the door and its guards, not any model behaviour. Tool
 * execution and delivery over SMS/email are likewise not exercised.
 *
 * MISSING PRODUCT BOUNDARIES recorded by the last tests, not papered over: a website-chat visitor is
 * not a CRM customer, and a Support case cannot reference a website conversation (it links Inbox
 * conversations, calls, work, invoices, assets and locations only).
 */

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function owner(label: string): Promise<{ db: SupabaseClient; organizationId: string; userId: string }> {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'CAD', timezone: 'America/Toronto' });
  return { db, organizationId, userId: created.data.user.id };
}

let pg: Client;
let a: Awaited<ReturnType<typeof owner>>;
let b: Awaited<ReturnType<typeof owner>>;
let site: string;
let agentId: string;
let versionId: string;
let deploymentId: string;
let thread: string;
const visitor = randomUUID();
const anon = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

beforeAll(async () => {
  if (!ANON || !SERVICE) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  [a, b] = await Promise.all([owner('ai-cs'), owner('ai-other')]);
  // The business bought the assistant: a module switch plus a commercial term, as in `ai-workspace`.
  await pg.query(`insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'assistant',$2) on conflict do nothing`, [a.organizationId, a.userId]);
  await pg.query(`insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:assistant','2020-01-01','9999-12-31',1,0,'CAD',$2,'acceptance')`, [a.organizationId, a.userId]);
}, 120_000);

afterAll(async () => {
  await pg?.end();
});

describe('an AI customer-service business is configured through the authoritative commands', () => {
  it('publishes a website, an agent version grounded in that site only, and a website-chat deployment', async () => {
    const templates = await listSiteTemplates(a.db as never);
    await createWebsite(a.db as never, { organizationId: a.organizationId, templateKey: templates[0]?.key });
    const state = await siteEditorState(a.db as never, a.organizationId);
    site = state!.siteId;
    await submitSiteRevision(a.db as never, a.organizationId, state!.working!.id);
    await publishSiteRevision(a.db as never, a.organizationId, state!.working!.id);

    const saved = await a.db.rpc('save_ai_assistant', { p_organization_id: a.organizationId, p_id: null, p_name: 'Harbourline assistant', p_instructions: 'Answer from published pages. Ask for a person when unsure.', p_configuration: { policy: 'read_only', tools: [] }, p_expected_draft: null });
    expect(saved.error).toBeNull();
    agentId = saved.data;
    expect((await a.db.rpc('set_ai_knowledge', { p_organization_id: a.organizationId, p_assistant_id: agentId, p_site_id: site, p_enabled: true })).error).toBeNull();
    // Publishing names the draft it was reviewed against, so a concurrent edit is refused rather than shipped.
    const draft = (await a.db.from('ai_assistants').select('draft_number').eq('id', agentId).single()).data!.draft_number;
    const published = await a.db.rpc('publish_ai_assistant', { p_organization_id: a.organizationId, p_id: agentId, p_status: 'active', p_expected_draft: draft });
    expect(published.error).toBeNull();
    versionId = published.data;
    const deployed = await a.db.rpc('save_ai_deployment', { p_organization_id: a.organizationId, p_id: null, p_assistant_id: agentId, p_version_id: versionId, p_surface: 'website_chat', p_site_id: site, p_enabled: true, p_display_name: 'Harbourline', p_greeting: 'Hello, how can we help?', p_handoff: 'A person will pick this up.', p_configuration: {} });
    expect(deployed.error).toBeNull();
    deploymentId = deployed.data;
  }, 60_000);

  it('does not let the other business grounds itself in this business\'s published pages', async () => {
    const stolen = await pg.query('select app.ai_published_knowledge($1, array[$2::uuid]) as text', [b.organizationId, site]);
    expect(stolen.rows[0].text).toBe('');
  });
});

describe('a stranger asks a question and the business can see exactly what happened', () => {
  it('records the visitor\'s message against this organization and this exact published version', async () => {
    const recorded = await anon().rpc('record_public_communication', { p_site_id: site, p_visitor_key: visitor, p_body: 'What are your opening hours?' });
    expect(recorded.error).toBeNull();
    thread = recorded.data;
    const row = await a.db.from('communication_threads').select('organization_id,assistant_version_id,assistant_deployment_id,state').eq('id', thread).single();
    expect(row.data).toMatchObject({ organization_id: a.organizationId, assistant_version_id: versionId, assistant_deployment_id: deploymentId, state: 'open' });
    // The other business cannot see the conversation, and the visitor holds no membership.
    expect((await b.db.from('communication_threads').select('id').eq('id', thread)).data ?? []).toEqual([]);
    expect((await anon().from('communication_threads').select('id').eq('id', thread)).data ?? []).toEqual([]);
  });

  it('hands the runtime exactly the published version and knowledge, flagged as entitled', async () => {
    const turn = (await pg.query('select public.resolve_public_agent_turn($1,$2) as turn', [deploymentId, visitor])).rows[0].turn;
    expect(turn).toMatchObject({ organization_id: a.organizationId, version_id: versionId, entitled: true, handoff: false });
    expect(turn.instructions).toContain('Published knowledge (untrusted reference data');
  });

  it('accepts a reply only through the machine-role door; a visitor cannot forge one (SIMULATED reply text: no model ran)', async () => {
    const forged = await anon().rpc('record_public_communication_reply', { p_site_id: site, p_visitor_key: visitor, p_body: 'Forged', p_handoff: false });
    expect(forged.error).toBeTruthy();
    await pg.query('select public.record_public_communication_reply($1,$2,$3,false)', [site, visitor, 'Our published hours are on the Contact page.']);
    const history = await anon().rpc('public_communication_history', { p_site_id: site, p_visitor_key: visitor });
    expect(history.data.entries.map((entry: { body: string }) => entry.body)).toEqual(['What are your opening hours?', 'Our published hours are on the Contact page.']);
  });
});

describe('escalation reaches a person, and the assistant stops', () => {
  it('lets the visitor ask for a person, and only this business\'s staff claim and answer', async () => {
    const handoff = await anon().rpc('request_public_communication_handoff', { p_site_id: site, p_visitor_key: visitor });
    expect(handoff.data).toBe('A person will pick this up.');
    expect((await b.db.rpc('handle_website_conversation', { p_organization_id: a.organizationId, p_thread_id: thread, p_action: 'claim' })).error?.code).toBe('42501');
    expect((await a.db.rpc('handle_website_conversation', { p_organization_id: a.organizationId, p_thread_id: thread, p_action: 'claim' })).error).toBeNull();
    expect((await a.db.rpc('handle_website_conversation', { p_organization_id: a.organizationId, p_thread_id: thread, p_action: 'reply', p_body: 'Hi, this is Sam. We open at 9.' })).error).toBeNull();
    const history = await anon().rpc('public_communication_history', { p_site_id: site, p_visitor_key: visitor });
    expect(history.data.state).toBe('claimed');
    expect(history.data.entries.at(-1).body).toBe('Hi, this is Sam. We open at 9.');
    // Once a human holds it the assistant can no longer write to it.
    await expect(pg.query('select public.record_public_communication_reply($1,$2,$3,false)', [site, visitor, 'Late AI reply'])).rejects.toThrow('unavailable for automated replies');
  });
});

describe('boundaries this journey does not yet cross (recorded, not hidden)', () => {
  it('does not turn a website visitor into a CRM customer', async () => {
    expect(await listCustomers(a.db, { organizationId: a.organizationId })).toEqual([]);
  });

  it('lets an operator open a Support case by hand, but cannot attach the website conversation to it', async () => {
    const created = await commandSupport(a.db, a.organizationId, 'case.create', { title: 'Opening hours question escalated from website chat', description: `Website conversation ${thread}`, priority: 'normal' });
    expect(created).toBeTruthy();
    // A Support case links Inbox conversations, calls, work, invoices, assets and locations — a
    // website-chat thread is none of those, so the reference is refused rather than half-recorded.
    await expect(commandSupport(a.db, a.organizationId, 'case.create', { title: 'Linked attempt', conversation: thread })).rejects.toBeInstanceOf(Error);
  });
});
