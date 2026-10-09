import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '@/lib/db/types';
import { foundBusiness } from '@/tests/support/founding';
import { seedHomeFixture } from '@/tests/support/home-fixture';
import { loadHome } from '@/lib/application/home/load';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { createRole } from '@/lib/domain/tenancy/roles';
import { addMember } from '@/lib/domain/tenancy/members';
import { commandSupport } from '@/lib/domain/support/support';
import { changeFollowUpStatus } from '@/lib/domain/follow-ups/follow-ups';
import { listInvoicedAndIncurred, totalsByCurrency, readFinancialTotals } from '@/lib/domain/reporting/financials';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { shiftDate, zonedTimeToInstant } from '@/lib/domain/scheduling/window';
import { recordPayment } from '@/lib/domain/billing/invoices';
import { commandMarketing } from '@/lib/domain/marketing/marketing';
import { saveFormDraft, publishFormRevision } from '@/lib/domain/forms/forms';
import { createCallOutcome } from '@/lib/domain/reception/outcomes';

const url = process.env.SUPABASE_URL!;
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local Home verification only');
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const pg = new Client(process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres');
async function actor() {
  const email = `home-${randomUUID()}@example.test`, password = randomUUID();
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (user.error) throw user.error;
  const db = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as Db;
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { db, email };
}
let owner: Awaited<ReturnType<typeof actor>>, reader: typeof owner, outsider: typeof owner, colleague: typeof owner;
let fixture: Awaited<ReturnType<typeof seedHomeFixture>>;
const home = async (db = owner.db, query = {}) => loadHome(db, (await getOrganization(db, fixture.organizationId))!, query);
const sources = (data: Awaited<ReturnType<typeof home>>) => data.results.flatMap(r => r.state === 'ready' ? [r.data] : []);
describe('Global Home against canonical local data and RLS', () => {
  beforeAll(async () => {
    await pg.connect(); owner = await actor(); reader = await actor(); outsider = await actor(); colleague = await actor();
    const organizationId = await foundBusiness({ ownerEmail: owner.email, name: 'Home database verification', currency: 'CAD', timezone: 'America/Toronto' });
    fixture = await seedHomeFixture(owner.db, organizationId, pg);
    const role = await createRole(owner.db, { organizationId, name: 'Kernel reader', capabilities: [] });
    await addMember(owner.db, { organizationId, email: reader.email, roleId: role });
    const agentRole = await createRole(owner.db, { organizationId, name: 'Private Agent member', capabilities: ['assistant.ask'] });
    await addMember(owner.db, { organizationId, email: colleague.email, roleId: agentRole });
  }, 120000);
  afterAll(async () => { await pg.end(); await Promise.all([owner?.db.auth.signOut(), reader?.db.auth.signOut(), outsider?.db.auth.signOut(), colleague?.db.auth.signOut()]); });
  it('projects only actor-private Agent metadata and never private conversation content', async () => {
    const mine = await home();
    const ai = sources(mine).find(s => s.source === 'AI')!;
    expect(ai.categories.find(c => c.key === 'approval')!.total).toBe(1);
    expect(ai.categories.find(c => c.key === 'interaction')!.total).toBe(1);
    const theirs = await home(colleague.db);
    const colleagueAI = sources(theirs).find(s => s.source === 'AI')!;
    expect(colleagueAI.categories.find(c => c.key === 'approval')!.total).toBe(0);
    expect(colleagueAI.categories.find(c => c.key === 'interaction')!.total).toBe(0);
    expect(JSON.stringify([mine, theirs])).not.toContain('PRIVATE_HOME');
  });
  it('counts beyond previews and counts a multi-resource Work item once', async () => {
    const data = await home(), rows = sources(data);
    expect(data.results.filter(r => r.state === 'unavailable')).toEqual([]);
    expect(rows.find(s => s.source === 'Support')!.categories.find(c => c.key === 'case-urgent')!.total).toBe(12);
    expect(rows.find(s => s.source === 'Work')!.metrics[0].value).toBe(1);
    expect(rows.find(s => s.source === 'Work')!.categories.find(c => c.key === 'unscheduled-work')!.total).toBe(15);
    expect(rows.find(s => s.source === 'CRM')!.categories[0].total).toBe(12);
    expect(data.kpis.length).toBeLessThanOrEqual(4);
    expect(rows.flatMap(s => s.attention).every(i => i.organizationId === fixture.organizationId)).toBe(true);
    expect(rows.find(s => s.source === 'Work')!.attention.find(i => i.record.id === fixture.scheduled)).toMatchObject({ urgency: 'high', description: expect.stringContaining('Person missing') });
    expect(rows.find(s => s.source === 'Work')!.attention.find(i => i.record.id === fixture.scheduled)!.description).toContain('unavailable');
  });
  it('separates stored currencies, acquisition inquiries, Customers and delivery evidence', async () => {
    const rows = sources(await home(owner.db, { when: 'month' }));
    const finance = rows.find(s => s.source === 'Finance')!;
    expect(finance.performance.filter(m => m.key.startsWith('Outstanding invoices')).map(m => m.label)).toEqual(expect.arrayContaining(['Outstanding invoices · CAD', 'Outstanding invoices · USD']));
    expect(finance.categories[0].total).toBe(2);
    expect(rows.find(s => s.source === 'Marketing')!.categories[0].total).toBe(1);
    expect(rows.find(s => s.source === 'CRM')!.performance[0].value).toBe(1);
    expect(rows.find(s => s.source === 'Communications')!.categories.find(c => c.key === 'missed-call')!.total).toBe(1);
    expect(rows.find(s => s.source === 'Automations')!.categories.find(c => c.key === 'run')!.total).toBe(1);
    expect(rows.find(s => s.source === 'Marketing')!.categories.find(c => c.key === 'campaign-setup')!.total).toBe(1);
    expect(rows.find(s => s.source === 'Automations')!.health.some(h => h.key === 'rule-readiness')).toBe(true);
    const period = (await home(owner.db, { when: 'month' })).period;
    expect(await readFinancialTotals(owner.db, fixture.organizationId, period.from, period.to)).toEqual(totalsByCurrency(await listInvoicedAndIncurred(owner.db, { organizationId: fixture.organizationId, grouping: 'customer', period })));
    expect(finance.performance.filter(m => m.key.startsWith('Invoiced:')).map(m => m.value)).toEqual(expect.arrayContaining(['CA$120.00', 'US$120.00']));
  });
  it('projects Mine through actual membership and Resource assignments', async () => {
    const rows = sources(await home(owner.db, { scope: 'mine' }));
    expect(rows.find(s => s.source === 'Support')!.categories.find(c => c.key === 'case-urgent')!.total).toBe(3);
    expect(rows.find(s => s.source === 'CRM')!.categories[0].total).toBe(3);
    expect(rows.find(s => s.source === 'Work')!.today).toHaveLength(1);
    expect(rows.flatMap(s => s.attention).every(i => i.ownerMembershipId === fixture.membership)).toBe(true);
    expect(sources(await home(reader.db, { scope: 'mine' })).flatMap(s => s.attention)).toEqual([]);
  });
  it('omits restricted counts, money, activity and actions for a low privilege member and denies outsiders', async () => {
    const data = await home(reader.db);
    expect(data.results.map(r => r.source)).toEqual(['CRM', 'Work']);
    expect(data.quickActions).toEqual([]);
    expect((await reader.db.rpc('home_studio_summary', { p_organization_id: fixture.organizationId })).error).not.toBeNull();
    expect((await outsider.db.rpc('home_studio_summary', { p_organization_id: fixture.organizationId })).error).not.toBeNull();
    await expect(readFinancialTotals(reader.db, fixture.organizationId, '2026-10-01', '2026-11-01')).rejects.toThrow();
    await expect(readFinancialTotals(outsider.db, fixture.organizationId, '2026-10-01', '2026-11-01')).rejects.toThrow();
    const anon = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } }) as Db;
    expect((await anon.rpc('home_studio_summary', { p_organization_id: fixture.organizationId })).error).not.toBeNull();
    await expect(readFinancialTotals(anon, fixture.organizationId, '2026-10-01', '2026-11-01')).rejects.toThrow();
    for (const restricted of ['Invoice #', 'Home urgent Case', 'Home inquiry', 'Home controlled failure', 'CAD', 'USD']) expect(JSON.stringify(data)).not.toContain(restricted);
    expect(await getOrganization(outsider.db, fixture.organizationId)).toBeNull();
    await expect(loadHome(outsider.db, (await getOrganization(owner.db, fixture.organizationId))!, { scope: 'mine' })).rejects.toThrow();
  });
  it('removes resolved Cases and completed Follow-ups on refresh through canonical writes', async () => {
    await commandSupport(owner.db, fixture.organizationId, 'case.resolve', { id: fixture.cases[0], summary: 'Verified in owning Case workflow' });
    await changeFollowUpStatus(owner.db, { organizationId: fixture.organizationId, id: fixture.followUps[0], status: 'completed' });
    const rows = sources(await home());
    expect(rows.find(s => s.source === 'Support')!.categories.find(c => c.key === 'case-urgent')!.total).toBe(11);
    expect(rows.find(s => s.source === 'CRM')!.categories[0].total).toBe(11);
  });
  it('keeps an actual failing source unknown while other authorized sources remain available', async () => {
    const failing = new Proxy(owner.db, { get(target, key, receiver) {
      if (key === 'from') return (relation: string) => target.from((relation === 'support_case_records' ? '__home_fault_fixture' : relation) as never);
      return Reflect.get(target, key, receiver);
    } });
    const data = await home(failing);
    expect(data.results.find(r => r.source === 'Support')).toEqual({ source: 'Support', state: 'unavailable' });
    expect(data.results.filter(r => r.state === 'ready').length).toBe(8);
    expect(data.kpis.some(k => k.key === 'cases')).toBe(false);
  });
  it('refreshes scheduling, inquiry handoff, invoice settlement and Form publishing from their owning commands', async () => {
    const organizationId = fixture.organizationId;
    await scheduleWorkItem(owner.db, { workItemId: fixture.waiting[0], resourceIds: [fixture.resource], startsAt: zonedTimeToInstant(shiftDate(fixture.date, 3), '10:00', 'America/Toronto'), endsAt: zonedTimeToInstant(shiftDate(fixture.date, 3), '11:00', 'America/Toronto') });
    await commandMarketing(owner.db, organizationId, 'inquiry.handoff', { id: fixture.inquiry, create: true, name: 'Home handed-off Customer' });
    await recordPayment(owner.db, { invoiceId: fixture.invoices[0].id, amountMinor: 10000 });
    const outcome = await createCallOutcome(owner.db, { organizationId, name: 'Followed up', reached: false });
    const wrapped = await owner.db.rpc('record_call_outcome', { p_organization_id: organizationId, p_call_id: fixture.missed, p_outcome_id: outcome, p_note: 'Controlled owning Call wrap-up', p_duration_seconds: 0 });
    expect(wrapped.error).toBeNull();
    await saveFormDraft(owner.db, { organizationId, revisionId: fixture.unpublishedForm.revisionId, definition: { title: 'Published verification', submitLabel: 'Submit', confirmation: { title: 'Received', message: 'Received.' }, fields: [{ id: 'name', type: 'short_text', label: 'Name', required: true }] } });
    await publishFormRevision(owner.db, { organizationId, revisionId: fixture.unpublishedForm.revisionId });
    const rows = sources(await home());
    expect(rows.find(s => s.source === 'Work')!.categories.find(c => c.key === 'unscheduled-work')!.total).toBe(14);
    expect(rows.find(s => s.source === 'Marketing')!.categories.find(c => c.key === 'inquiry')!.total).toBe(0);
    expect(rows.find(s => s.source === 'CRM')!.performance[0].value).toBe(2);
    expect(rows.find(s => s.source === 'Finance')!.categories[0].total).toBe(1);
    expect(rows.find(s => s.source === 'Communications')!.categories.find(c => c.key === 'missed-call')!.total).toBe(0);
    expect(rows.find(s => s.source === 'Studio')!.categories.find(c => c.key === 'form-draft')!.total).toBe(0);
  });
  it('reports enabled Agent configuration without asserting live provider operation', async () => {
    const p_organization_id = fixture.organizationId;
    // Generated RPC types omit SQL argument nullability; null requests creation and no site binding.
    const nullId = null as unknown as string;
    const assistant = await owner.db.rpc('save_ai_assistant', { p_organization_id, p_id: nullId, p_name: 'Home governed Agent', p_instructions: 'Use authorized read tools and request approval.', p_configuration: { policy: 'read_only', tools: [] } });
    expect(assistant.error).toBeNull();
    const version = await owner.db.rpc('publish_ai_assistant', { p_organization_id, p_id: assistant.data!, p_status: 'active', p_expected_draft: 1 });
    expect(version.error).toBeNull();
    const deployment = await owner.db.rpc('save_ai_deployment', { p_organization_id, p_id: nullId, p_assistant_id: assistant.data!, p_version_id: version.data!, p_surface: 'operator_copilot', p_site_id: nullId, p_enabled: true, p_display_name: 'Home operator', p_greeting: 'Hello', p_handoff: 'Request help', p_configuration: {} });
    expect(deployment.error).toBeNull();
    const ai = sources(await home()).find(s => s.source === 'AI')!;
    expect(ai.health.find(h => h.key === `deployment:${deployment.data}`)?.state).toBe(process.env.ASSISTANT_API_URL ? 'Enabled · runtime unverified' : 'Unavailable');
  });
});
