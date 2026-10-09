import type { Db } from '@/lib/db/types';
import type { Organization } from '@/lib/domain/tenancy/organizations';
import { availableFeatureKeys, activeModuleKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { currentMembershipId } from '@/lib/domain/reception/inbox';
import { hasSchedulableWork } from '@/lib/domain/work-items/types';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { areaAvailable, areaHref, WORKSPACES } from '@/lib/navigation';
import { DomainError } from '@/lib/domain/errors';
import { homePeriod, homeQuery, type HomeData, type HomeResult, type HomeSource, type HomeSourceData } from './contracts';
import { readCrm, readWork, readSupportHome, readMarketingHome, readCommunications, readFinanceHome, readAutomationHome, readAiHome, readStudioHome, type ReadContext } from './reads';

export async function isolateSource(source: HomeSource, read: () => Promise<HomeSourceData>): Promise<HomeResult> {
  try { return { source, state: 'ready', data: await read() }; }
  catch { return { source, state: 'unavailable' }; }
}

export async function loadHome(db: Db, organization: Organization, rawQuery: Record<string, string | string[] | undefined> = {}): Promise<HomeData> {
  const organizationId = organization.id, date = todayInZone(organization.timezone), query = homeQuery(rawQuery);
  const [featureStates, membershipId, schedulable] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    currentMembershipId(db, { organizationId }),
    hasSchedulableWork(db, { organizationId }),
  ]);
  if (!membershipId) throw new DomainError('Organization membership required.', 'home.forbidden');
  const capabilities = new Set<string>(organization.capabilities), features = availableFeatureKeys(featureStates), enabled = activeModuleKeys(featureStates);
  const available = (segment: string) => areaAvailable(segment, { capabilities: new Set(organization.capabilities), featureAvailability: features, enabled, schedulableWork: schedulable });
  const resource = await db.from('resources').select('id').eq('organization_id', organizationId).eq('membership_id', membershipId).maybeSingle();
  if (resource.error) throw new DomainError('Personal resource projection unavailable.', 'home.resource_failed');
  const period = homePeriod(date, organization.timezone, query.when), now = new Date().toISOString();
  const c: ReadContext = { db, organizationId, membershipId, resourceId: resource.data?.id ?? null, schedulable, date, timezone: organization.timezone, now, query, period, capabilities, features, assistantEntitled: enabled.has('assistant') };
  const jobs: [HomeSource, () => Promise<HomeSourceData>][] = [['CRM', () => readCrm(c)]];
  jobs.push(['Work', () => readWork(c)]);
  if (available('comms')) jobs.push(['Communications', () => readCommunications(c)]);
  if (available('marketing')) jobs.push(['Marketing', () => readMarketingHome(c)]);
  if (available('support')) jobs.push(['Support', () => readSupportHome(c)]);
  if (available('finance-invoices') && capabilities.has('report.read')) jobs.push(['Finance', () => readFinanceHome(c)]);
  if (available('automations')) jobs.push(['Automations', () => readAutomationHome(c)]);
  if (enabled.has('assistant') && (capabilities.has('assistant.ask') || capabilities.has('organization.manage'))) jobs.push(['AI', () => readAiHome(c)]);
  if (capabilities.has('organization.manage')) jobs.push(['Studio', () => readStudioHome(c)]);
  const results = await Promise.all(jobs.map(([source, read]) => isolateSource(source, read)));
  // Metadata only: no notes, message previews, transcripts, money or Agent conversations in the shared event feed.
  const eventGroups: [HomeSource, string[], (kind: string, id: string) => string][] = [
    ['CRM', ['customer.created', 'customer.updated', 'opportunity.created', 'opportunity.stage_changed', 'follow_up.created', 'follow_up.completed'], (kind, id) => kind === 'customer' ? `/organizations/${organizationId}/customers/${id}` : kind === 'opportunity' ? `/organizations/${organizationId}/opportunities/${id}` : `/organizations/${organizationId}/follow-ups?selected=${id}&status=all`],
    ['Work', ['work_item.created', 'work_item.scheduled', 'work_item.unscheduled', 'work_item.assigned', 'work_item.status_changed'], (_, id) => `/organizations/${organizationId}/work/${id}`],
    ['Finance', ['invoice.issued', 'payment.recorded'], (_, id) => `/organizations/${organizationId}/work/${id}`],
    ['Marketing', ['marketing_campaign.created', 'marketing_campaign.updated', 'marketing_inquiry.reviewed', 'marketing_inquiry.handed_off'], (kind, id) => kind === 'marketing_campaign' ? `/organizations/${organizationId}/marketing/campaigns/${id}` : `/organizations/${organizationId}/marketing/leads?inquiry=${id}`],
  ];
  await Promise.all(eventGroups.map(async ([source, actions, href]) => {
    const result = results.find(r => r.source === source);
    if (result?.state !== 'ready') return;
    const allowedActions = source === 'CRM' && !features.has('follow_ups') ? actions.filter(a => !a.startsWith('follow_up.')) : actions;
    const events = await db.from('events').select('id,entity_type,entity_id,action,occurred_at').eq('organization_id', organizationId).in('action', allowedActions).gte('occurred_at', period.since).lt('occurred_at', period.until).order('occurred_at', { ascending: false }).order('id').limit(5);
    if (events.error) {
      result.data.health.push({ key: `${source}:activity-unavailable`, source, state: 'Activity unavailable', detail: 'The operational summary is available; recent activity could not be read.', href: areaHref(organizationId, source === 'CRM' ? 'sales' : source === 'Work' ? 'field' : source.toLowerCase()), warning: true });
      return;
    }
    result.data.activity.push(...(events.data ?? []).map(e => ({ key: `${source}:event:${e.id}`, source, title: e.action.replaceAll('_', ' ').replace('.', ' · '), at: e.occurred_at, href: href(e.entity_type, e.entity_id) })));
  }));
  for (const result of results) if (result.state === 'ready') {
    const workspace = WORKSPACES.find(w => w.label === result.source);
    const configured = featureStates.filter(f => workspace && (workspace.featureKeys as readonly string[]).includes(f.featureKey) && f.entitled && f.activation === 'active');
    const setup = configured.filter(f => f.readiness === 'setup_required');
    for (const f of setup) if (f.setupHref && capabilities.has('organization.manage')) result.data.health.push({ key: `feature:${f.featureKey}`, source: result.source, state: 'Configuration required', detail: f.reason ?? f.featureKey.replaceAll('_', ' '), href: f.setupHref, warning: true });
    if (result.data.health.length === 0) result.data.health.push({ key: `${result.source}:read`, source: result.source, state: 'Read available', detail: 'Authorized records loaded. Live provider health is not inferred.', href: areaHref(organizationId, workspace?.home ?? 'home'), warning: false });
  }
  const priorities = ['scheduled', 'opportunities', 'cases', 'overdue-invoices', 'inbox', 'inquiries', 'failed-runs', 'missed', 'active-work'];
  const metrics = results.flatMap(r => r.state === 'ready' ? r.data.metrics : []);
  const kpis = metrics.sort((a, b) => priorities.indexOf(a.key) - priorities.indexOf(b.key)).slice(0, 4);
  const base = `/organizations/${organizationId}`;
  const quickActions: HomeData['quickActions'] = [];
  const add = (key: string, capability: string, label: string, href: string, description: string) => { if (capabilities.has(capability)) quickActions.push({ key, label, href, description }); };
  add('customer', 'customer.create', 'New customer', `${base}/customers?create=1`, 'Open CRM and add a customer');
  add('work', 'work_item.create', 'New Work', `${base}/work?create=1`, 'Open the canonical Work creation drawer');
  if (available('support')) add('case', 'support.case.create', 'New Case', `${base}/support/cases?create=1`, 'Open Cases and create a problem or request');
  if (available('marketing')) add('campaign', 'marketing.manage', 'New campaign', `${base}/marketing/campaigns?create=1`, 'Open Campaigns and create a draft');
  if (available('finance-invoices')) add('invoice', 'invoice.issue', 'New invoice', `${base}/finance/invoices`, 'Open Finance and issue an invoice');
  if (available('comms-inbox')) add('message', 'message.send', 'Compose message', `${base}/comms/inbox/new`, 'Open Inbox and compose through the configured channel');
  if (available('automations')) add('rule', 'automation.manage', 'New automation', `${base}/automations/rules?create=1`, 'Open the canonical rule builder');
  add('form', 'organization.manage', 'New Form', `${base}/studio/forms?create=1`, 'Open Forms and create a draft');
  const search = [{ label: 'CRM', href: `${base}/sales/search` }, { label: 'Work', href: `${base}/work` }, ...results.filter(r => !['CRM', 'Work', 'Studio', 'AI', 'Finance', 'Automations'].includes(r.source)).map(r => ({ label: r.source, href: r.source === 'Support' ? `${base}/support/cases` : r.source === 'Marketing' ? `${base}/marketing/leads` : available('comms-inbox') ? `${base}/comms/inbox` : `${base}/calls` }))];
  const agentPrompts = capabilities.has('assistant.ask') && enabled.has('assistant') ? [
    ...(schedulable ? ['Which Work is at risk?', 'What is scheduled tomorrow?'] : []),
    'Which Customers have not been contacted?',
    ...(capabilities.has('report.read') && available('finance-invoices') ? ['What was invoiced this month?'] : []),
  ] : [];
  return { organizationId, membershipId, date, timezone: organization.timezone, refreshedAt: now, query, period, results, kpis, quickActions, search, agentPrompts };
}
