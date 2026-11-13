import type { Db } from '@/lib/db/types';
import type { Organization } from '@/lib/domain/tenancy/organizations';
import { availableFeatureKeys, activeModuleKeys, organizationResolvedFeatureStates, type ResolvedFeatureState } from '@/lib/domain/catalogue/organization-plans';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable, areaHref, WORKSPACES, configTargetForHref } from '@/lib/navigation';
import { DomainError } from '@/lib/domain/errors';
import { homePeriod, homeQuery, type HomeData, type HomeResult, type HomeSource, type HomeSourceData } from './contracts';
import { readCrm, readWork, readSupportHome, readMarketingHome, readCommunications, readFinanceHome, readAutomationHome, readAiHome, readStudioHome, type ReadContext } from './reads';

export async function isolateSource(source: HomeSource, read: () => Promise<HomeSourceData>): Promise<HomeResult> {
  try { return { source, state: 'ready', data: await read() }; }
  catch { return { source, state: 'unavailable' }; }
}

export async function loadHome(db: Db, organization: Organization, rawQuery: Record<string, string | string[] | undefined> = {}): Promise<HomeData> {
  const organizationId = organization.id, date = todayInZone(organization.timezone), query = homeQuery(rawQuery);
  const [featureStates, membershipId, workShape] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    currentMembershipId(db, { organizationId }),
    hasSchedulableWork(db, { organizationId }).then(value => ({ value, failed: false }), () => ({ value: false, failed: true })),
  ]);
  if (!membershipId) throw new DomainError('Organization membership required.', 'home.forbidden');
  const schedulable = workShape.value;
  const capabilities = new Set<string>(organization.capabilities), features = availableFeatureKeys(featureStates), enabled = activeModuleKeys(featureStates);
  const available = (segment: string) => areaAvailable(segment, { capabilities: new Set(organization.capabilities), featureAvailability: features, enabled, schedulableWork: schedulable });
  const resource = await db.from('resources').select('id').eq('organization_id', organizationId).eq('membership_id', membershipId).maybeSingle();

  const period = homePeriod(date, organization.timezone, query.when), now = new Date().toISOString();
  const c: ReadContext = { db, organizationId, membershipId, resourceId: resource.data?.id ?? null, schedulable, date, timezone: organization.timezone, now, query, period, capabilities, features, assistantEntitled: enabled.has('assistant') };
  const jobs: [HomeSource, () => Promise<HomeSourceData>][] = [['CRM', () => readCrm(c)]];
  jobs.push(['Work', () => { if (workShape.failed || resource.error) throw new DomainError('Work could not load.', 'home.work_unavailable'); return readWork(c); }]);
  if (available('comms')) jobs.push(['Communications', () => readCommunications(c)]);
  if (available('marketing')) jobs.push(['Marketing', () => readMarketingHome(c)]);
  if (available('support')) jobs.push(['Support', () => readSupportHome(c)]);
  if (available('finance-invoices') && capabilities.has('report.read')) jobs.push(['Finance', () => readFinanceHome(c)]);
  if (available('automations')) jobs.push(['Automations', () => readAutomationHome(c)]);
  if (enabled.has('assistant') && (capabilities.has('assistant.ask') || capabilities.has('organization.manage'))) jobs.push(['AI', () => readAiHome(c)]);
  if (capabilities.has('organization.manage')) jobs.push(['Studio', () => readStudioHome(c)]);
  const results = await Promise.all(jobs.map(([source, read]) => isolateSource(source, read)));
  // Metadata only: no notes, message previews, transcripts, money or Agent conversations in the shared event feed.
  // Plain titles for the event codes Home lists; a code is never shown as stored.
  const ACTIVITY_TITLE: Record<string, string> = { 'customer.created': 'Contact added', 'customer.updated': 'Contact changed', 'opportunity.created': 'Opportunity added', 'opportunity.stage_changed': 'Opportunity moved', 'follow_up.created': 'Task added', 'follow_up.completed': 'Task done', 'work_item.created': 'Work added', 'work_item.scheduled': 'Work scheduled', 'work_item.unscheduled': 'Work unscheduled', 'work_item.assigned': 'Work assigned', 'work_item.status_changed': 'Work moved to a new stage', 'invoice.issued': 'Invoice issued', 'payment.recorded': 'Payment recorded', 'marketing_campaign.created': 'Campaign added', 'marketing_campaign.updated': 'Campaign changed', 'marketing_inquiry.reviewed': 'Inquiry reviewed', 'marketing_inquiry.handed_off': 'Inquiry handed off' };
  const eventGroups: [HomeSource, string[], (kind: string, id: string) => string][] = [
    ['CRM', ['customer.created', 'customer.updated', 'opportunity.created', 'opportunity.stage_changed', 'follow_up.created', 'follow_up.completed'], (kind, id) => kind === 'customer' ? `/organizations/${organizationId}/crm/contacts/${id}` : kind === 'opportunity' ? `/organizations/${organizationId}/crm/opportunities/${id}` : `/organizations/${organizationId}/crm/tasks?selected=${id}&status=all`],
    ['Work', ['work_item.created', 'work_item.scheduled', 'work_item.unscheduled', 'work_item.assigned', 'work_item.status_changed'], (_, id) => `/organizations/${organizationId}/work/${id}`],
    ['Finance', ['invoice.issued', 'payment.recorded'], (_, id) => `/organizations/${organizationId}/work/${id}?section=financials`],
    ['Marketing', ['marketing_campaign.created', 'marketing_campaign.updated', 'marketing_inquiry.reviewed', 'marketing_inquiry.handed_off'], (kind, id) => kind === 'marketing_campaign' ? `/organizations/${organizationId}/marketing/campaigns/${id}` : `/organizations/${organizationId}/marketing/leads?inquiry=${id}`],
  ];
  const activityPeriod = homePeriod(date, organization.timezone, 'week');
  await Promise.all(eventGroups.map(async ([source, actions, href]) => {
    const result = results.find(r => r.source === source);
    if (result?.state !== 'ready') return;
    const allowedActions = source === 'CRM' && !features.has('follow_ups') ? actions.filter(a => !a.startsWith('follow_up.')) : actions;
    const events = await db.from('events').select('id,entity_type,entity_id,action,occurred_at').eq('organization_id', organizationId).in('action', allowedActions).gte('occurred_at', activityPeriod.since).lt('occurred_at', activityPeriod.until).order('occurred_at', { ascending: false }).order('id').limit(5);
    if (events.error) {
      result.data.health.push({ key: `${source}:activity-unavailable`, source, state: 'Activity unavailable', detail: 'The operational summary is available; recent activity could not be read.', href: areaHref(organizationId, source === 'CRM' ? 'sales' : source === 'Work' ? 'field' : source.toLowerCase()), warning: true });
      return;
    }
    result.data.activity.push(...(events.data ?? []).map(e => ({ key: `${source}:event:${e.id}`, source, title: ACTIVITY_TITLE[e.action] ?? 'Activity', at: e.occurred_at, href: href(e.entity_type, e.entity_id), recordKey: `${e.entity_type === 'work_item' ? 'Work' : source}:${e.entity_type === 'work_item' ? 'work-item' : e.entity_type === 'follow_up' ? 'follow-up' : e.entity_type}:${e.entity_id}` })));
  }));
  assignSetupHealth(results, featureStates, capabilities);
  const priorities = ['scheduled', 'overdue-invoices', 'opportunities', 'cases', 'inbox', 'inquiries', 'failed-runs', 'missed', 'active-work'];
  const metrics = results.flatMap(r => r.state === 'ready' ? r.data.metrics : []);
  const meaningful = metrics.filter(metric => typeof metric.value !== 'number' || metric.value > 0);
  const kpis = (meaningful.length ? meaningful : metrics.filter(metric => ['active-work', 'scheduled', 'opportunities'].includes(metric.key)))
    .sort((a, b) => priorities.indexOf(a.key) - priorities.indexOf(b.key)).slice(0, 4);
  const base = `/organizations/${organizationId}`;
  const quickActions: HomeData['quickActions'] = [];
  const add = (key: string, capability: string, label: string, href: string, description: string) => { if (capabilities.has(capability)) quickActions.push({ key, label, href, description }); };
  // A role that adds contacts without viewing them adds from CRM Home; the directory is not theirs to open.
  add('customer', 'customer.create', 'New contact', capabilities.has('customer.read') ? `${base}/crm/contacts?create=1` : `${base}/crm?create=1`, 'Open CRM and add a contact');
  add('work', 'work_item.create', 'New work', `${base}/work/new`, 'Create and assign Work');
  if (available('support')) add('case', 'support.case.create', 'New case', `${base}/support/cases?create=1`, 'Open Cases and create a problem or request');
  if (available('marketing')) add('campaign', 'marketing.manage', 'New campaign', `${base}/marketing/campaigns?create=1`, 'Open Campaigns and create a draft');
  if (available('finance-invoices')) add('invoice', 'invoice.issue', 'New invoice', `${base}/finance/invoices?create=1`, 'Open Finance and issue an invoice');
  if (available('comms-inbox')) add('message', 'message.send', 'Compose message', `${base}/comms/inbox/new`, 'Open Conversations and write a message');
  if (available('automations')) add('rule', 'automation.manage', 'New automation', `${base}/automations/rules?create=1`, 'Create an automation');
  add('form', 'organization.manage', 'New form', `${base}/studio/forms?create=1`, 'Open Forms and create a draft');
  const search = [{ label: 'CRM', href: `${base}/crm/search` }, { label: 'Work', href: `${base}/work` }, ...results.filter(r => !['CRM', 'Work', 'Studio', 'AI', 'Finance', 'Automations'].includes(r.source)).map(r => ({ label: r.source, href: r.source === 'Support' ? `${base}/support/cases` : r.source === 'Marketing' ? `${base}/marketing/leads` : available('comms-inbox') ? `${base}/comms/inbox` : `${base}/calls` }))];
  const agentPrompts = capabilities.has('assistant.ask') && enabled.has('assistant') ? [
    ...(schedulable ? ['Which Work is at risk?', 'What is scheduled tomorrow?'] : []),
    'Which Customers have not been contacted?',
    ...(capabilities.has('report.read') && available('finance-invoices') ? ['What was invoiced this month?'] : []),
  ] : [];
  return { organizationId, membershipId, date, timezone: organization.timezone, refreshedAt: now, query, period, results, kpis, quickActions, search, agentPrompts };
}

/** Destination ownership and message deduplication belong to the read projection, not the UI. */
export function assignSetupHealth(results: HomeResult[], features: readonly Pick<ResolvedFeatureState, 'featureKey' | 'entitled' | 'activation' | 'readiness' | 'setupHref' | 'reason'>[], capabilities: ReadonlySet<string>) {
  // Configuration destinations own cross-workspace setup issues, even when several features depend on them.
  for (const result of results) if (result.state === 'ready') {
    const workspace = WORKSPACES.find(w => w.label === result.source);
    const setup = features.filter(f => workspace && (workspace.featureKeys as readonly string[]).includes(f.featureKey) && f.entitled && f.activation === 'active' && f.readiness === 'setup_required');
    for (const f of setup) if (f.setupHref) {
      const target = configTargetForHref(f.setupHref);
      if (target ? !target.permission.some(permission => capabilities.has(permission)) : !capabilities.has('organization.manage')) continue;
      const owner = WORKSPACES.find(w => w.key === target?.workspace)?.label ?? result.source;
      const destination = results.find(r => r.source === owner);
      if (destination?.state === 'ready') destination.data.health.push({ key: `feature:${f.featureKey}`, source: owner, state: 'Needs setup', detail: f.reason ?? 'This feature needs setting up.', href: f.setupHref, warning: true });
    }
  }
  for (const result of results) if (result.state === 'ready') {
    result.data.health = [...new Map(result.data.health.map(h => [`${h.source}:${h.detail.trim().toLowerCase()}`, h])).values()];
  }
}
