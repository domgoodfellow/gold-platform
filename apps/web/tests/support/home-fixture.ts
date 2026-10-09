import { randomUUID } from 'node:crypto';
import { asPlatformStaff } from './founding';
import { createPlan, grantPlanProduct } from '../../lib/domain/catalogue/plans';
import { recordPlanAssignment } from '../../lib/domain/catalogue/organization-plans';
import type { Client } from 'pg';
import type { Db } from '../../lib/db/types';
import { createCustomer } from '../../lib/domain/customers/customers';
import { createFollowUp } from '../../lib/domain/follow-ups/follow-ups';
import { createWorkItemType } from '../../lib/domain/work-items/types';
import { createWorkItemStatus, updateWorkItemStatus } from '../../lib/domain/work-items/statuses';
import { createWorkItem } from '../../lib/domain/work-items/work-items';
import { createResource } from '../../lib/domain/resources/resources';
import { scheduleWorkItem } from '../../lib/domain/scheduling/schedule';
import { createResourceRequirement } from '../../lib/domain/work-items/requirements';
import { createResourceAvailabilityException } from '../../lib/domain/scheduling/resource-availability';
import { setModuleEnabled } from '../../lib/domain/tenancy/modules';
import { commandSupport } from '../../lib/domain/support/support';
import { createPriceBookItem } from '../../lib/domain/pricing/price-book';
import { addPricedLine } from '../../lib/domain/pricing/prices';
import { issueInvoice, recordPayment } from '../../lib/domain/billing/invoices';
import { getOrganization, updateOrganization } from '../../lib/domain/tenancy/organizations';
import { commandMarketing, readMarketing } from '../../lib/domain/marketing/marketing';
import { createForm, saveFormDraft, publishFormRevision, formEditorState } from '../../lib/domain/forms/forms';
import { submitPublicFormByKey } from '../../lib/domain/forms/public-forms';
import { createWebsite } from '../../lib/domain/public-site/public-site';
import { createAutomationRule, addAutomationAction } from '../../lib/domain/automation/rules';
import { todayInZone, zonedTimeToInstant, shiftDate } from '../../lib/domain/scheduling/window';

export async function grantHomeVerificationPlan(organizationId: string) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.SUPABASE_URL ?? '').hostname)) throw new Error('Home fixtures are local only');
  const staff = await asPlatformStaff();
  const planId = await createPlan(staff, { key: `home_${randomUUID().slice(0, 8)}`, kind: 'plan', label: 'Local Home verification', description: 'Local fixture only', billable: false });
  const products = await staff.from('platform_catalog_products').select('key');
  if (products.error) throw products.error;
  for (const product of products.data) await grantPlanProduct(staff, { planId, productKey: product.key });
  await recordPlanAssignment(staff, { organizationId, planId, periodStart: '2026-01-01', periodEnd: '9999-12-31', note: 'Local Home verification fixture' });
}

export async function seedHomeFixture(db: Db, organizationId: string, pg: Client) {
  await grantHomeVerificationPlan(organizationId);
  const actor = (await db.auth.getUser()).data.user!;
  const membership = (await db.from('memberships').select('id').eq('organization_id', organizationId).eq('user_id', actor.id).single()).data!.id;
  for (const key of ['reception', 'billing', 'automations', 'assistant'] as const) await setModuleEnabled(db, { organizationId, key, enabled: true });
  const date = todayInZone('America/Toronto');
  const at = (days: number, time = '10:00') => zonedTimeToInstant(shiftDate(date, days), time, 'America/Toronto');
  const customer = await createCustomer(db, { organizationId, name: 'Home verification Customer' });
  const type = await createWorkItemType(db, { organizationId, name: 'Home service', schedulable: true });
  const status = await createWorkItemStatus(db, { organizationId, typeId: type, name: 'Open' });
  const terminal = await createWorkItemStatus(db, { organizationId, typeId: type, name: 'Complete', position: 1 });
  await updateWorkItemStatus(db, { id: terminal, name: 'Complete', position: 1, marksComplete: true, releasesResource: true });
  const resource = await createResource(db, { organizationId, name: 'Home operator', resourceClass: 'person', membershipId: membership });
  const vehicle = await createResource(db, { organizationId, name: 'Home service van', resourceClass: 'vehicle' });
  const waiting: string[] = [];
  for (let i = 0; i < 12; i++) waiting.push(await createWorkItem(db, { organizationId, statusId: status, title: `Home waiting ${String(i).padStart(2, '0')}`, customerId: customer }));
  const scheduled = await createWorkItem(db, { organizationId, statusId: status, title: 'Home assigned service', customerId: customer });
  await scheduleWorkItem(db, { workItemId: scheduled, resourceIds: [resource, vehicle], startsAt: at(0), endsAt: at(0, '11:00') });
  const tomorrow = await createWorkItem(db, { organizationId, statusId: status, title: 'Home tomorrow service', customerId: customer });
  await scheduleWorkItem(db, { workItemId: tomorrow, resourceIds: [resource], startsAt: at(1), endsAt: at(1, '11:00') });
  await createResourceRequirement(db, { typeId: type, resourceClass: 'person', quantity: 2, capabilityIds: [] });
  await createResourceAvailabilityException(db, { resourceId: resource, startsAt: at(0), endsAt: at(0, '11:00'), reason: 'Local controlled absence after assignment' });
  await createWorkItem(db, { organizationId, statusId: terminal, title: 'Home complete must not require scheduling' });
  const followUps: string[] = [];
  for (let i = 0; i < 12; i++) followUps.push(await createFollowUp(db, { organizationId, customerId: customer, kind: 'task', title: `Home overdue follow-up ${i}`, dueAt: at(-1), ownerMembershipId: i < 3 ? membership : null }));
  const cases: string[] = [];
  for (let i = 0; i < 12; i++) cases.push(await commandSupport(db, organizationId, 'case.create', { title: `Home urgent Case ${i}`, priority: 'urgent', customer, ...(i < 3 ? { owner: membership } : {}) }));
  const resolved = await commandSupport(db, organizationId, 'case.create', { title: 'Home resolved Case', priority: 'urgent' });
  await commandSupport(db, organizationId, 'case.resolve', { id: resolved, summary: 'Controlled verification resolution' });
  const invoices: { id: string; work: string; currency: string }[] = [];
  for (const currency of ['CAD', 'USD']) {
    const org = (await getOrganization(db, organizationId))!;
    await updateOrganization(db, { ...org, currency });
    const price = await createPriceBookItem(db, { organizationId, name: `Home service ${currency}`, unit: 'visit', unitAmountMinor: 12000 });
    const work = await createWorkItem(db, { organizationId, statusId: status, title: 'Home financial service', customerId: customer });
    await addPricedLine(db, { workItemId: work, priceBookItemId: price, quantity: 1 });
    const id = await issueInvoice(db, { workItemId: work, issuedAt: at(-5), dueAt: at(-1) });
    await recordPayment(db, { invoiceId: id, amountMinor: 2000 });
    invoices.push({ id, work, currency });
  }
  const org = (await getOrganization(db, organizationId))!;
  await updateOrganization(db, { ...org, currency: 'CAD' });
  const campaign = await commandMarketing(db, organizationId, 'campaign.create', { name: 'Home acquisition', objective: 'lead_generation', channels: ['form'] });
  await commandMarketing(db, organizationId, 'campaign.create', { name: 'Home source setup required', objective: 'lead_generation', channels: ['form'] });
  const form = await createForm(db, { organizationId, name: 'Home inquiry' });
  await saveFormDraft(db, { organizationId, revisionId: form.revisionId, definition: { title: 'Home inquiry', submitLabel: 'Submit', confirmation: { title: 'Received', message: 'Your inquiry will be reviewed.' }, fields: [{ id: 'name', type: 'short_text', label: 'Name', required: true }] } });
  await publishFormRevision(db, { organizationId, revisionId: form.revisionId });
  await commandMarketing(db, organizationId, 'campaign.form', { id: campaign, form: form.formId });
  await commandMarketing(db, organizationId, 'campaign.status', { id: campaign, status: 'active' });
  const token = (await readMarketing(db, organizationId, 'detail', { campaign })).campaigns[0].forms[0].token;
  const publicKey = (await formEditorState(db, organizationId, form.formId))!.form.publicKey;
  const submitted = await submitPublicFormByKey(db, { publicKey, revisionId: form.revisionId, answers: { name: 'Home controlled Inquiry' }, source: 'hosted', attribution: { token, utm: { utm_source: 'home-verification' }, requestId: randomUUID() } });
  if (!submitted.ok) throw new Error(submitted.message);
  const inquiry = (await readMarketing(db, organizationId, 'leads')).inquiries[0].id;
  const unpublishedForm = await createForm(db, { organizationId, name: 'Home unpublished Form' });
  await createWebsite(db, { organizationId });
  const rule = await createAutomationRule(db, { organizationId, name: 'Home controlled failure', triggerKind: 'event', triggerEventAction: 'work_item.created' });
  await addAutomationAction(db, { organizationId, ruleId: rule, kind: 'change_status', statusId: terminal });
  const failedWork = await createWorkItem(db, { organizationId, statusId: status, title: 'Home failure trigger' });
  await createAutomationRule(db, { organizationId, name: 'Home rule missing action', triggerKind: 'event', triggerEventAction: 'work_item.created', enabled: true });
  // Local carrier ingress fixture; ordinary recordCall correctly records only completed calls.
  const missed = (await pg.query("insert into public.calls (organization_id,customer_id,direction,status,from_number,to_number,created_by) values ($1,$2,'inbound','no_answer','+14165550101','+14165550102',$3) returning id", [organizationId, customer, actor.id])).rows[0].id as string;
  const conversation = await db.from('agent_conversations').insert({ organization_id: organizationId, created_by: actor.id, title: 'PRIVATE_HOME_CONVERSATION' }).select('id').single();
  if (conversation.error) throw conversation.error;
  const runs = await db.from('agent_runs').insert([
    { organization_id: organizationId, created_by: actor.id, conversation_id: conversation.data.id, question: 'PRIVATE_HOME_QUESTION', answer: 'PRIVATE_HOME_ANSWER', outcome: 'answered', tools: [], answered_by: 'local-fixture', proposed_action: { name: 'propose_reschedule', arguments: { work_item_id: scheduled, starts_at: at(2), ends_at: at(2, '11:00') }, because: 'Controlled local approval fixture' }, action_outcome: 'pending' },
    { organization_id: organizationId, created_by: actor.id, conversation_id: conversation.data.id, question: 'PRIVATE_HOME_FAILED_QUESTION', answer: '', detail: 'PRIVATE_HOME_FAILED_DETAIL', outcome: 'failed', tools: [], answered_by: 'local-fixture' },
  ]);
  if (runs.error) throw runs.error;
  return { organizationId, membership, customer, type, status, terminal, resource, vehicle, waiting, scheduled, tomorrow, followUps, cases, resolved, invoices, campaign, form, unpublishedForm, inquiry, rule, failedWork, missed, date };
}
