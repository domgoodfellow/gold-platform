import type { Db } from '@/lib/db/types';
import { HomeStudioSummarySchema } from '@gold/schemas';
import { DomainError } from '@/lib/domain/errors';
import type { Counted } from '@/lib/domain/counted';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listOpportunities } from '@/lib/domain/opportunities/opportunities';
import { listFollowUps, type FollowUp } from '@/lib/domain/follow-ups/follow-ups';
import { listWorkItems, type WorkItem } from '@/lib/domain/work-items/work-items';
import { evaluateWorkItems, describeShortfall } from '@/lib/domain/work-items/requirements';
import { listAvailabilityConflicts } from '@/lib/domain/scheduling/resource-availability';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import { listCallPage } from '@/lib/domain/reception/calls';
import { listInbox } from '@/lib/domain/reception/inbox';
import { readFinanceInvoices, readFinanceSummary } from '@/lib/domain/billing/finance-reads';
import { readFinancialTotals } from '@/lib/domain/reporting/financials';
import { deploymentReadiness } from '@/lib/domain/ai/agents';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { shiftDate, zonedDayRange } from '@/lib/domain/scheduling/window';
import { emptySource, type HomeAttentionItem, type HomeSource, type HomeSourceData, type HomeQuery, type homePeriod } from './contracts';

export type ReadContext = { db: Db; organizationId: string; membershipId: string; resourceId: string | null; schedulable: boolean; date: string; timezone: string; now: string; query: HomeQuery; period: ReturnType<typeof homePeriod>; features: Set<string>; capabilities: Set<string>; assistantEntitled: boolean };
const LIMIT = 5;
function countedTotal<T>(rows: Counted<T>): number {
  if (typeof rows.exactCount !== 'number') throw new DomainError('The source did not return an exact count.', 'home.count_unavailable');
  return rows.exactCount;
}
function checked<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new DomainError(result.error.message, 'home.source_unavailable');
  if (result.data === null) throw new DomainError('The source returned no projection.', 'home.source_unavailable');
  return result.data;
}
function exact(result: { count: number | null; error: { message: string } | null }): number {
  if (result.error || result.count === null) throw new DomainError('The source did not return an exact count.', 'home.count_unavailable');
  return result.count;
}
function item(c: ReadContext, source: HomeSource, kind: string, id: string, title: string, description: string, href: string, extra: Partial<HomeAttentionItem> = {}): HomeAttentionItem {
  return { key: `${source}:${kind}:${id}`, organizationId: c.organizationId, source, category: kind, title, description, urgency: 'normal', overdue: false, record: { kind, id }, destination: { href, label: 'Open' }, ...extra };
}
function followUp(c: ReadContext, f: FollowUp) {
  return item(c, 'CRM', 'follow-up', f.id, f.title, f.customerName, `/organizations/${c.organizationId}/follow-ups?selected=${f.id}`, { dueAt: f.dueAt, ownerMembershipId: f.ownerMembershipId, ownerName: f.ownerName, overdue: f.dueAt < c.now, urgency: f.dueAt < c.now ? 'high' : 'normal' });
}
function workItem(c: ReadContext, w: WorkItem, category: string) {
  return item(c, 'Work', 'work-item', w.id, w.title, `${w.status.label}${w.customer ? ` · ${w.customer.label}` : ''}`, `/organizations/${c.organizationId}/work/${w.id}`, { category, dueAt: w.window?.startsAt, ownerMembershipId: w.resources.some(r => r.id === c.resourceId) ? c.membershipId : null, ownerName: w.resources.map(r => r.label).join(', ') || 'Unassigned' });
}
function obligations(data: HomeSourceData, items: HomeAttentionItem[], c: ReadContext) {
  const day = zonedDayRange(c.date, c.timezone), end = zonedDayRange(shiftDate(c.date, 7), c.timezone).startsAt;
  for (const i of items) if (i.dueAt && i.dueAt >= day.startsAt && i.dueAt < end) {
    const row = { key: i.key, source: i.source, title: i.title, at: i.dueAt, context: i.description, owner: i.ownerName ?? 'Unassigned', href: i.destination.href };
    if (i.dueAt < day.endsAt) data.today.push(row); else data.upcoming.push(row);
  }
}

export async function readCrm(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('CRM'), base = `/organizations/${c.organizationId}`, day = zonedDayRange(c.date, c.timezone);
  const [customers, opportunities] = await Promise.all([
    listCustomers(c.db, { organizationId: c.organizationId, limit: 1 }),
    listOpportunities(c.db, { organizationId: c.organizationId, kind: 'open', limit: 1 }),
  ]);
  d.metrics.push({ key: 'opportunities', label: 'Open opportunities', value: countedTotal(opportunities), definition: 'Current opportunities in stages classified Open', href: `${base}/opportunities?kind=open` });
  d.performance.push({ key: 'customers', label: 'Customers', value: countedTotal(customers), definition: 'All recorded customer relationships · current', href: `${base}/customers` });
  if (!c.features.has('follow_ups')) return d;
  const scope = c.query.scope === 'mine' ? { ownerMembershipId: c.membershipId } : {};
  const cutoff = c.query.attention === 'all' ? day.endsAt : c.now;
  const [due, dated, mine] = await Promise.all([
    listFollowUps(c.db, { organizationId: c.organizationId, status: 'open', before: cutoff, ...scope, limit: LIMIT }),
    listFollowUps(c.db, { organizationId: c.organizationId, status: 'open', from: day.startsAt, before: zonedDayRange(shiftDate(c.date, 7), c.timezone).startsAt, ...scope, limit: LIMIT }),
    listFollowUps(c.db, { organizationId: c.organizationId, status: 'open', ownerMembershipId: c.membershipId, before: day.endsAt, limit: 3 }),
  ]);
  d.attention = due.map(f => followUp(c, f)); d.priorities = mine.map(f => followUp(c, f));
  d.categories.push({ key: 'follow-up', label: c.query.attention === 'all' ? 'Follow-ups due by today' : 'Overdue follow-ups', total: countedTotal(due), href: `${base}/follow-ups?status=open&${c.query.attention === 'all' ? `to=${c.date}` : 'due=overdue'}${c.query.scope === 'mine' ? `&owner=${c.membershipId}` : ''}` });
  obligations(d, dated.map(f => followUp(c, f)), c);
  return d;
}

export async function readWork(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('Work'), base = `/organizations/${c.organizationId}`, day = zonedDayRange(c.date, c.timezone);
  if (!c.schedulable) {
    const active = await listWorkItems(c.db, { organizationId: c.organizationId, active: true, limit: 1 });
    d.metrics.push({ key: 'active-work', label: 'Active Work', value: countedTotal(active), definition: 'Work in statuses that retain Resources · current', href: `${base}/work` });
    return d;
  }
  const scope = c.query.scope === 'mine' ? { resourceIds: c.resourceId ? [c.resourceId] : ['00000000-0000-0000-0000-000000000000'] } : {};
  const [today, upcoming, mine] = await Promise.all([
    listWorkItems(c.db, { organizationId: c.organizationId, active: true, within: day, ...scope, sort: 'schedule', limit: LIMIT }),
    listWorkItems(c.db, { organizationId: c.organizationId, active: true, within: { startsAt: day.endsAt, endsAt: zonedDayRange(shiftDate(c.date, 7), c.timezone).startsAt }, ...scope, sort: 'schedule', limit: LIMIT }),
    c.resourceId ? listWorkItems(c.db, { organizationId: c.organizationId, active: true, resourceId: c.resourceId, within: day, sort: 'schedule', limit: 3 }) : null,
  ]);
  d.metrics.push({ key: 'scheduled', label: c.query.scope === 'mine' ? 'My scheduled Work' : 'Scheduled today', value: countedTotal(today), definition: 'Active Work overlapping today · one count per Work item', href: `${base}/schedule?on=${c.date}${c.query.scope === 'mine' && c.resourceId ? `&resource=${c.resourceId}` : ''}` });
  for (const [rows, target] of [[today, d.today], [upcoming, d.upcoming]] as const) for (const w of rows) if (w.window) target.push({ key: `Work:${w.id}`, source: 'Work', title: w.title, at: w.window.startsAt, context: `${w.status.label}${w.customer ? ` · ${w.customer.label}` : ''}`, owner: w.resources.map(r => r.label).join(', ') || 'Unassigned', href: `${base}/work/${w.id}` });
  d.priorities = (mine ?? []).map(w => workItem(c, w, 'assigned-work'));
  const [coverage, conflicts] = await Promise.all([
    evaluateWorkItems(c.db, { organizationId: c.organizationId, items: today.map(w => ({ workItemId: w.id, typeId: w.type.id, resourceIds: w.resources.map(r => r.id) })) }),
    listAvailabilityConflicts(c.db, { organizationId: c.organizationId, within: day }),
  ]);
  const affected = today.flatMap(w => {
    const shortfall = coverage.get(w.id), conflict = conflicts.find(r => r.workItemId === w.id);
    const details = [shortfall && !shortfall.satisfied ? describeShortfall(shortfall, RESOURCE_CLASS_LABELS) : null, conflict ? conflict.problem === 'unavailable' ? 'Assigned Resource is unavailable' : 'Outside assigned Resource hours' : null].filter(Boolean);
    return details.length ? [{ ...workItem(c, w, 'scheduling-exception'), urgency: 'high' as const, description: details.join(' · ') }] : [];
  });
  if (c.query.attention !== 'overdue') d.attention.push(...affected);
  d.priorities = d.priorities.map(row => affected.find(i => i.key === row.key) ?? row);
  d.health.push({ key: 'work-check-preview', source: 'Work', state: affected.length ? 'Scheduling exceptions in preview' : 'Scheduling check preview', detail: `${today.length} of ${countedTotal(today)} scheduled Work items checked for canonical coverage and availability. Open Dispatch for its complete queue.`, href: `${base}/work/dispatch?on=${c.date}`, warning: affected.length > 0 });
  if (c.query.attention !== 'all') return d;
  const [unscheduled, unassigned] = await Promise.all([
    listWorkItems(c.db, { organizationId: c.organizationId, active: true, scheduled: false, ...scope, limit: LIMIT }),
    c.query.scope === 'organization' ? listWorkItems(c.db, { organizationId: c.organizationId, active: true, scheduled: true, unassigned: true, limit: LIMIT }) : null,
  ]);
  d.attention.push(...unscheduled.map(w => workItem(c, w, 'unscheduled-work')), ...(unassigned ?? []).map(w => workItem(c, w, 'unassigned-work')));
  d.categories.push({ key: 'unscheduled-work', label: 'Unscheduled Work', total: countedTotal(unscheduled), href: `${base}/work/dispatch?assignment=unscheduled${c.query.scope === 'mine' && c.resourceId ? `&resource=${c.resourceId}` : ''}` });
  if (unassigned) d.categories.push({ key: 'unassigned-work', label: 'Unassigned scheduled Work', total: countedTotal(unassigned), href: `${base}/work/dispatch?assignment=unassigned` });
  return d;
}

export async function readSupportHome(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('Support'), base = `/organizations/${c.organizationId}/support`, day = zonedDayRange(c.date, c.timezone);
  const columns = 'id,case_number,title,status,priority,assigned_membership_id,owner_name,customer_name,resolution_due_at,updated_at,escalated_at';
  const active = () => c.db.from('support_case_records').select(columns, { count: 'exact' }).eq('organization_id', c.organizationId).in('status', ['new', 'open', 'waiting']);
  const scoped = () => c.query.scope === 'mine' ? active().eq('assigned_membership_id', c.membershipId) : active();
  const filters = [
    { key: 'overdue', label: 'Overdue Cases', query: scoped().lt('resolution_due_at', c.now), href: '&attention=overdue' },
    ...(c.query.attention !== 'overdue' ? [
      { key: 'urgent', label: 'Urgent Cases', query: scoped().eq('priority', 'urgent'), href: '&attention=urgent' },
      { key: 'high', label: 'High-priority Cases', query: scoped().eq('priority', 'high'), href: '&priority=high' },
      { key: 'escalated', label: 'Escalated Cases', query: scoped().not('escalated_at', 'is', null), href: '&attention=escalated' },
    ] : []),
    ...(c.query.attention === 'all' && c.query.scope === 'organization' ? [{ key: 'unassigned', label: 'Unassigned Cases', query: scoped().is('assigned_membership_id', null), href: '&attention=unassigned' }] : []),
  ];
  const [queues, all, mine, dated, events] = await Promise.all([
    Promise.all(filters.map(f => f.query.order('resolution_due_at', { nullsFirst: false }).order('id').limit(LIMIT))),
    scoped().limit(1),
    active().eq('assigned_membership_id', c.membershipId).order('resolution_due_at', { nullsFirst: false }).order('id').limit(3),
    scoped().gte('resolution_due_at', day.startsAt).lt('resolution_due_at', zonedDayRange(shiftDate(c.date, 7), c.timezone).startsAt).order('resolution_due_at').order('id').limit(LIMIT),
    c.db.from('support_case_events').select('id,case_id,kind,occurred_at').eq('organization_id', c.organizationId).gte('occurred_at', c.period.since).lt('occurred_at', c.period.until).order('occurred_at', { ascending: false }).order('id').limit(LIMIT),
  ]);
  const project = (r: NonNullable<typeof all.data>[number]) => item(c, 'Support', 'case', r.id!, `${r.case_number} · ${r.title}`, r.customer_name ?? r.status ?? 'Case', `${base}/cases/${r.id}`, { dueAt: r.resolution_due_at ?? undefined, occurredAt: r.updated_at ?? undefined, ownerMembershipId: r.assigned_membership_id, ownerName: r.owner_name, overdue: !!r.resolution_due_at && r.resolution_due_at < c.now, urgency: r.priority === 'urgent' ? 'critical' : r.priority === 'high' || (r.resolution_due_at && r.resolution_due_at < c.now) || r.escalated_at ? 'high' : 'normal' });
  d.attention = [...new Map(queues.flatMap(q => checked(q).map(project)).map(i => [i.key, i])).values()];
  d.priorities = checked(mine).map(project); obligations(d, checked(dated).map(project), c);
  d.categories.push(...queues.map((q, i) => ({ key: `case-${filters[i].key}`, label: filters[i].label, total: exact(q), href: `${base}/cases?status=active${filters[i].href}${c.query.scope === 'mine' ? `&owner=${c.membershipId}` : ''}` })));
  d.metrics.push({ key: 'cases', label: c.query.scope === 'mine' ? 'My active Cases' : 'Active Support Cases', value: exact(all), definition: 'New, Open and Waiting · excludes Resolved and Closed', href: `${base}/cases?status=active${c.query.scope === 'mine' ? `&owner=${c.membershipId}` : ''}` });
  d.activity = checked(events).map(e => ({ key: `Support:event:${e.id}`, source: 'Support', title: `Case ${e.kind.replaceAll('_', ' ')}`, at: e.occurred_at, href: `${base}/cases/${e.case_id}` }));
  return d;
}

export async function readCommunications(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('Communications'), base = `/organizations/${c.organizationId}`;
  if (c.capabilities.has('call.place') && ['inbound_calling', 'outbound_calling'].some(f => c.features.has(f))) {
    const [wrap, missed, follow] = await Promise.all([
      listCallPage(c.db, { organizationId: c.organizationId, filter: { needsWrapUp: true, ...(c.query.scope === 'mine' ? { membershipId: c.membershipId } : {}) }, limit: LIMIT }),
      c.query.scope === 'organization' ? listCallPage(c.db, { organizationId: c.organizationId, filter: { state: 'missed', since: c.period.since, until: c.period.until }, limit: LIMIT }) : null,
      c.query.scope === 'organization' && c.query.attention !== 'overdue' ? listCallPage(c.db, { organizationId: c.organizationId, filter: { needsFollowUp: true }, limit: LIMIT }) : null,
    ]);
    if (c.query.attention !== 'overdue') {
      d.attention.push(...wrap.items.map(call => item(c, 'Communications', 'call-wrap-up', call.id, call.customerName ?? 'Completed call', 'Completed call awaiting outcome', `${base}/calls/${call.id}`, { urgency: 'high', occurredAt: call.startedAt, ownerMembershipId: call.handledBy.some(m => m.membershipId === c.membershipId) ? c.membershipId : null, ownerName: call.handledBy.map(m => m.name).join(', ') || 'Unassigned' })));
      if (wrap.total === undefined) throw new DomainError('Call count unavailable.', 'home.count_unavailable');
      d.categories.push({ key: 'call-wrap-up', label: 'Calls awaiting wrap-up', total: wrap.total, href: `${base}/calls?wrap=1${c.query.scope === 'mine' ? `&member=${c.membershipId}` : ''}` });
    }
    if (follow) {
      if (follow.total === undefined) throw new DomainError('Call count unavailable.', 'home.count_unavailable');
      d.attention.push(...follow.items.map(call => item(c, 'Communications', 'missed-call', call.id, call.customerName ?? 'Missed inbound call', 'Missed call awaiting a recorded outcome', `${base}/calls/${call.id}`, { urgency: 'high', occurredAt: call.startedAt })));
      d.categories.push({ key: 'missed-call', label: 'Missed calls awaiting outcome', total: follow.total, href: `${base}/calls?followup=1` });
    }
    if (missed) {
      if (missed.total === undefined) throw new DomainError('Call count unavailable.', 'home.count_unavailable');
      d.metrics.push({ key: 'missed', label: 'Missed inbound calls', value: missed.total, definition: 'Inbound no-answer, busy or failed · selected period', href: `${base}/calls?state=missed&from=${c.period.from}&to=${c.period.to}` });
    }
    if (missed) d.activity.push(...missed.items.map(call => ({ key: `Communications:call:${call.id}`, source: 'Communications' as const, title: 'Missed inbound call', at: call.startedAt, href: `${base}/calls/${call.id}` })));
  }
  if (c.capabilities.has('message.send') && ['inbound_sms', 'outbound_sms', 'sending'].some(f => c.features.has(f))) {
    const [unread, mine, waiting, unassigned] = await Promise.all([
      listInbox(c.db, { organizationId: c.organizationId, membershipId: c.membershipId, filter: { view: c.query.scope === 'mine' ? 'mine' : 'unread' }, limit: LIMIT }),
      listInbox(c.db, { organizationId: c.organizationId, membershipId: c.membershipId, filter: { view: 'mine', status: 'open' }, limit: 3 }),
      listInbox(c.db, { organizationId: c.organizationId, membershipId: c.membershipId, filter: { status: 'open', ...(c.query.scope === 'mine' ? { view: 'mine' as const } : {}) }, limit: LIMIT }),
      c.query.scope === 'organization' ? listInbox(c.db, { organizationId: c.organizationId, filter: { view: 'unassigned' }, limit: LIMIT }) : null,
    ]);
    if ([unread, mine, waiting, ...(unassigned ? [unassigned] : [])].some(r => r.total === undefined)) throw new DomainError('Inbox count unavailable.', 'home.count_unavailable');
    const project = (r: typeof unread.items[number]) => item(c, 'Communications', 'conversation', r.id, r.subject ?? r.title, `${r.channel.toUpperCase()} · ${r.status}${r.unread ? ' · Unread' : ''}`, `${base}/comms/inbox/${r.id}`, { occurredAt: r.lastActivityAt, ownerMembershipId: r.assignee?.membershipId, ownerName: r.assignee?.name });
    if (c.query.attention === 'all') {
      d.attention.push(...[...new Map([...unread.items, ...waiting.items, ...(unassigned?.items ?? [])].map(r => [r.id,r])).values()].map(project));
      d.categories.push({ key: 'conversation', label: c.query.scope === 'mine' ? 'My active conversations' : 'Unread active conversations', total: unread.total!, href: `${base}/comms/inbox?view=${c.query.scope === 'mine' ? 'mine' : 'unread'}` }, { key: 'conversation-open', label: 'Conversations awaiting response', total: waiting.total!, href: `${base}/comms/inbox?status=open${c.query.scope === 'mine' ? '&view=mine' : ''}` });
      if (unassigned) d.categories.push({ key: 'conversation-unassigned', label: 'Unassigned conversations', total: unassigned.total!, href: `${base}/comms/inbox?view=unassigned` });
    }
    d.priorities = mine.items.map(project);
    d.metrics.push({ key: 'inbox', label: c.query.scope === 'mine' ? 'My conversations' : 'Unread conversations', value: unread.total!, definition: 'Active conversations · excludes Closed', href: `${base}/comms/inbox?view=${c.query.scope === 'mine' ? 'mine' : 'unread'}` });
  }
  return d;
}

export async function readMarketingHome(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('Marketing'), base = `/organizations/${c.organizationId}/marketing`;
  const [queue, acquired, recent, setup] = await Promise.all([
    c.db.from('marketing_inquiries').select('id,form_name_at_capture,campaign_name_at_capture,status,occurred_at', { count: 'exact' }).eq('organization_id', c.organizationId).in('status', ['new', 'in_review']).order('occurred_at').order('id').limit(LIMIT),
    c.db.from('marketing_inquiries').select('id', { count: 'exact', head: true }).eq('organization_id', c.organizationId).gte('occurred_at', c.period.since).lt('occurred_at', c.period.until),
    c.db.from('marketing_inquiries').select('id,form_name_at_capture,occurred_at').eq('organization_id', c.organizationId).gte('occurred_at', c.period.since).lt('occurred_at', c.period.until).order('occurred_at', { ascending: false }).order('id').limit(LIMIT),
    c.db.from('marketing_campaigns').select('id,name,created_at,owner_membership_id,forms:marketing_campaign_forms!marketing_campaign_forms_organization_id_campaign_id_fkey(form_id)', { count: 'exact' }).eq('organization_id', c.organizationId).neq('status', 'archived').in('objective', ['lead_generation', 'engagement']).is('forms', null).order('created_at', { ascending: false }).order('id').limit(LIMIT),
  ]);
  const rows = checked(queue);
  d.metrics.push({ key: 'inquiries', label: 'Inquiries awaiting review', value: exact(queue), definition: 'New and In review acquisition inquiries · current', href: `${base}/leads` });
  d.performance.push({ key: 'acquired', label: 'Acquisition inquiries received', value: exact(acquired), definition: 'Inquiries captured during the selected period · not Customers', href: `${base}/performance?from=${c.period.from}&to=${shiftDate(c.period.to, -1)}` });
  if (c.query.scope === 'organization' && c.query.attention === 'all') {
    d.attention = rows.map(r => item(c, 'Marketing', 'inquiry', r.id, r.form_name_at_capture, `${r.campaign_name_at_capture ?? 'Unattributed'} · ${r.status.replaceAll('_', ' ')}`, `${base}/leads?inquiry=${r.id}`, { occurredAt: r.occurred_at }));
    d.categories.push({ key: 'inquiry', label: 'Inquiries awaiting review', total: exact(queue), href: `${base}/leads` });
    d.attention.push(...checked(setup).map(r => item(c, 'Marketing', 'campaign', r.id, r.name, 'Acquisition campaign has no Form source associated', `${base}/campaigns/${r.id}`, { occurredAt: r.created_at, ownerMembershipId: r.owner_membership_id })));
    d.categories.push({ key: 'campaign-setup', label: 'Campaigns needing source setup', total: exact(setup), href: `${base}/campaigns?attention=setup` });
  }
  d.activity = checked(recent).map(r => ({ key: `Marketing:inquiry:${r.id}`, source: 'Marketing', title: `Inquiry received · ${r.form_name_at_capture}`, at: r.occurred_at, href: `${base}/leads?inquiry=${r.id}` }));
  return d;
}

export async function readFinanceHome(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('Finance'), base = `/organizations/${c.organizationId}/finance`;
  const [overdue, summary, financials] = await Promise.all([
    readFinanceInvoices(c.db, c.organizationId, { status: 'overdue', limit: LIMIT }),
    readFinanceSummary(c.db, c.organizationId, c.period.from, c.period.to),
    readFinancialTotals(c.db, c.organizationId, c.period.from, c.period.to),
  ]);
  d.metrics.push({ key: 'overdue-invoices', label: 'Overdue invoices', value: overdue.total, definition: 'Unsettled invoices past an explicit due instant · current', href: `${base}/invoices?status=overdue` });
  if (c.query.scope === 'organization') {
    d.attention = overdue.rows.map(r => item(c, 'Finance', 'invoice', r.id, `Invoice #${r.number}`, `${r.billedTo} · ${r.outstandingMinor === null ? 'Amount unavailable' : formatMoney(r.outstandingMinor, r.currency)}`, `/organizations/${c.organizationId}/work/${r.workItemId}`, { urgency: 'high', overdue: true, dueAt: r.dueAt ?? undefined }));
    d.categories.push({ key: 'invoice', label: 'Overdue invoices', total: overdue.total, href: `${base}/invoices?status=overdue` });
  }
  for (const [name, rows, definition, href] of [
    ['Payments recorded', summary.received, 'Signed payment records · selected period · not invoiced value', `${base}/payments?from=${c.period.from}&to=${c.period.to}`],
    ['Outstanding invoices', summary.outstanding, 'Current all-time receivables · no currency conversion', `${base}/invoices?status=outstanding`],
  ] as const) for (const r of rows) d.performance.push({ key: `${name}:${r.currency}`, label: `${name} · ${r.currency}`, value: formatMoney(Number(r.amount), r.currency), definition, href });
  for (const currency of new Set(summary.trend.map(r => r.currency))) d.trends.push({ currency, points: summary.trend.filter(r => r.currency === currency).map(r => ({ day: r.day, amountMinor: Number(r.amount) })) });
  for (const row of financials) for (const [label, amount] of [['Invoiced', row.invoicedMinor], ['Incurred Work costs', row.incurredMinor]] as const) if (amount !== null) d.performance.push({ key: `${label}:${row.currency}`, label: `${label} · ${row.currency}`, value: formatMoney(amount, row.currency), definition: `${label === 'Invoiced' ? 'Invoice issue dates' : 'Recorded Work cost dates'} · selected period · canonical financial report`, href: label === 'Invoiced' ? `${base}/invoices?from=${c.period.from}&to=${c.period.to}` : base });
  return d;
}

export async function readAutomationHome(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('Automations'), base = `/organizations/${c.organizationId}/automations`;
  const [runs, deliveries, rules] = await Promise.all([
    c.db.from('automation_runs').select('id,rule_name,occurred_at', { count: 'exact' }).eq('organization_id', c.organizationId).eq('outcome', 'failed').gte('occurred_at', c.period.since).lt('occurred_at', c.period.until).order('occurred_at', { ascending: false }).order('id').limit(LIMIT),
    c.db.from('message_deliveries').select('id,rule_name,channel,queued_at', { count: 'exact' }).eq('organization_id', c.organizationId).eq('state', 'failed').gte('queued_at', c.period.since).lt('queued_at', c.period.until).order('queued_at', { ascending: false }).order('id').limit(LIMIT),
    c.db.from('automation_rules').select('id,name,created_at,actions:automation_actions!automation_actions_rule_same_org(id)', { count: 'exact' }).eq('organization_id', c.organizationId).eq('enabled', true).is('actions', null).order('created_at', { ascending: false }).order('id').limit(LIMIT),
  ]);
  const runRows = checked(runs), messageRows = checked(deliveries);
  d.metrics.push({ key: 'failed-runs', label: 'Failed Automation runs', value: exact(runs), definition: 'Execution outcome Failed · selected period · separate from deliveries', href: `${base}/activity?outcome=failed&when=all&from=${c.period.from}&to=${c.period.to}` });
  if (c.query.scope === 'organization' && c.query.attention !== 'overdue') {
    d.attention = [...runRows.map(r => item(c, 'Automations', 'run', r.id, r.rule_name, 'Failed execution · inspect recorded evidence', `${base}/activity?run=${r.id}`, { urgency: 'high', occurredAt: r.occurred_at })), ...messageRows.map(r => item(c, 'Automations', 'delivery', r.id, r.rule_name, `Failed ${r.channel} delivery`, `${base}/activity?delivery=${r.id}`, { urgency: 'high', occurredAt: r.queued_at }))];
    d.categories.push({ key: 'run', label: 'Failed runs', total: exact(runs), href: `${base}/activity?outcome=failed&when=all&from=${c.period.from}&to=${c.period.to}` }, { key: 'delivery', label: 'Failed deliveries', total: exact(deliveries), href: `${base}/activity?state=failed&when=all&from=${c.period.from}&to=${c.period.to}&stream=deliveries` });
  }
  d.activity = [...runRows.map(r => ({ key: `Automations:run:${r.id}`, source: 'Automations' as const, title: `Execution failed · ${r.rule_name}`, at: r.occurred_at, href: `${base}/activity?run=${r.id}` })), ...messageRows.map(r => ({ key: `Automations:delivery:${r.id}`, source: 'Automations' as const, title: `Delivery failed · ${r.rule_name}`, at: r.queued_at, href: `${base}/activity?delivery=${r.id}` }))];
  if (exact(runs) || exact(deliveries)) d.health.push({ key: 'automation-failures', source: 'Automations', state: 'Failures recorded', detail: `${exact(runs)} runs · ${exact(deliveries)} deliveries in this period`, href: `${base}/activity`, warning: true });
  if (exact(rules)) {
    d.health.push({ key: 'rule-readiness', source: 'Automations', state: 'Enabled rules without actions', detail: `${exact(rules)} rules have no configured action. Full diagnostics remain in Rules.`, href: `${base}/rules?health=attention`, warning: true });
    if (c.query.scope === 'organization' && c.query.attention === 'all') d.attention.push(...checked(rules).map(r => item(c, 'Automations', 'rule', r.id, r.name, 'Enabled rule has no configured action', `${base}/${r.id}`, { occurredAt: r.created_at })));
  }
  return d;
}

export async function readAiHome(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('AI'), base = `/organizations/${c.organizationId}/ai`;
  // agent_runs RLS is actor-private. Only the signed-in actor's pending approvals are projected.
  const [runs, approvals] = await Promise.all([
    c.db.from('agent_runs').select('id,occurred_at,outcome', { count: 'exact' }).eq('organization_id', c.organizationId).gte('occurred_at', c.period.since).lt('occurred_at', c.period.until).eq('outcome', 'failed').order('occurred_at', { ascending: false }).order('id').limit(LIMIT),
    c.db.from('agent_runs').select('id,occurred_at', { count: 'exact' }).eq('organization_id', c.organizationId).eq('action_outcome', 'pending').order('occurred_at', { ascending: false }).order('id').limit(LIMIT),
  ]);
  const failed = checked(runs);
  const pending = checked(approvals);
  if (c.query.attention === 'all') {
    d.attention = pending.map(r => item(c, 'AI', 'approval', r.id, 'My pending Agent approval', 'Review in the global Agent rail', `${base}/activity`, { occurredAt: r.occurred_at, ownerMembershipId: c.membershipId, ownerName: 'You' }));
    d.priorities = d.attention; d.categories.push({ key: 'approval', label: 'My pending Agent approvals', total: exact(approvals), href: `${base}/activity` });
  }
  if (c.query.attention !== 'overdue') {
    d.attention.push(...failed.map(r => item(c, 'AI', 'interaction', r.id, 'My failed Agent interaction', 'Inspect in Agent activity; no private prompt or response is shared.', `${base}/activity?outcome=failed`, { urgency: 'high', occurredAt: r.occurred_at, ownerMembershipId: c.membershipId, ownerName: 'You' })));
    d.categories.push({ key: 'interaction', label: 'My failed Agent interactions', total: exact(runs), href: `${base}/activity?outcome=failed` });
  }
  if (c.query.scope === 'organization' && c.query.attention !== 'overdue' && c.capabilities.has('message.send')) {
    const handoffs = await c.db.from('communication_threads').select('id,updated_at', { count: 'exact' }).eq('organization_id', c.organizationId).eq('state', 'handoff_requested').order('updated_at', { ascending: false }).order('id').limit(LIMIT);
    d.attention.push(...checked(handoffs).map(r => item(c, 'AI', 'handoff', r.id, 'Website conversation needs a human', 'Requested handoff · transcript stays in Communications', `/organizations/${c.organizationId}/comms/inbox/website?thread=${r.id}`, { urgency: 'high', occurredAt: r.updated_at })));
    d.categories.push({ key: 'handoff', label: 'Website handoffs requested', total: exact(handoffs), href: `/organizations/${c.organizationId}/comms/inbox/website` });
  }
  if (!c.capabilities.has('organization.manage')) return d;
  const deployments = await c.db.from('ai_assistant_deployments').select('id,assistant_id,surface,version_id,enabled,display_name,updated_at', { count: 'exact' }).eq('organization_id', c.organizationId).eq('enabled', true).order('updated_at', { ascending: false }).order('id').limit(LIMIT);
  const ds = checked(deployments);
  if (!ds.length) d.health.push({ key: 'deployments-empty', source: 'AI', state: 'No enabled deployments', detail: 'Configuration and activation do not establish live provider operation.', href: `${base}/deployments`, warning: false });
  const states = ds.length ? checked(await c.db.from('ai_assistants').select('id,status').eq('organization_id', c.organizationId).in('id', ds.map(r => r.assistant_id))) : [];
  for (const dep of ds) {
    const readiness = deploymentReadiness(dep, states.find(a => a.id === dep.assistant_id), c.assistantEntitled, !!process.env.ASSISTANT_API_URL && (dep.surface !== 'website_chat' || !!process.env.PUBLIC_CHAT_API_SECRET));
    d.health.push({ key: `deployment:${dep.id}`, source: 'AI', state: readiness.state === 'Enabled' ? 'Enabled · runtime unverified' : readiness.state, detail: `${dep.display_name || dep.surface} · ${readiness.reason}`, href: `${base}/agents/${dep.assistant_id}?section=channels`, warning: readiness.state !== 'Enabled' });
    if (readiness.state !== 'Enabled' && c.query.scope === 'organization' && c.query.attention !== 'overdue') d.attention.push(item(c, 'AI', 'deployment', dep.id, dep.display_name || dep.surface, readiness.reason, `${base}/agents/${dep.assistant_id}?section=channels`, { urgency: 'high', occurredAt: dep.updated_at }));
  }
  if (exact(deployments) > ds.length) d.health.push({ key: 'deployments-more', source: 'AI', state: 'Bounded deployment preview', detail: `${ds.length} of ${exact(deployments)} enabled deployments inspected`, href: `${base}/agents`, warning: false });
  return d;
}

export async function readStudioHome(c: ReadContext): Promise<HomeSourceData> {
  const d = emptySource('Studio'), base = `/organizations/${c.organizationId}/studio`;
  const summary = HomeStudioSummarySchema.parse(checked(await c.db.rpc('home_studio_summary', { p_organization_id: c.organizationId })));
  const revisions = summary.working, drafts = summary.drafts, live = summary.published;
  if (c.query.scope === 'organization' && c.query.attention === 'all') {
    d.attention = [...revisions.map(r => item(c, 'Studio', 'website-revision', r.id, `Website revision ${r.revision_number}`, r.status === 'in_review' ? 'Publication awaiting review' : 'Unpublished draft', `${base}/website`, { occurredAt: r.created_at })), ...drafts.map(r => item(c, 'Studio', 'form-draft', r.id, r.name, 'Unpublished Form draft · review before publishing', `${base}/forms/${r.form_id}`, { occurredAt: r.created_at }))];
    d.categories.push({ key: 'website-revision', label: 'Unpublished website revisions', total: summary.workingTotal, href: `${base}/website` }, { key: 'form-draft', label: 'Form drafts', total: summary.draftTotal, href: `${base}/forms` });
  }
  d.health.push({ key: 'website', source: 'Studio', state: live.length ? 'Website published' : 'No published website', detail: revisions.length ? live.length ? 'Unpublished changes exist; public content stays on its published revision.' : 'A working draft exists; no website revision has been published.' : live.length ? 'Saved and published are separate states.' : 'Create and publish a website when required.', href: `${base}/website`, warning: revisions.length > 0 });
  d.activity = live.filter(r => r.published_at && r.published_at >= c.period.since && r.published_at < c.period.until).map(r => ({ key: `Studio:published:${r.id}`, source: 'Studio', title: `Website revision ${r.revision_number} published`, at: r.published_at!, href: `${base}/website` }));
  return d;
}
