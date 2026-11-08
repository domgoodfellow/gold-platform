import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';
import { callbackBase, telephonyProvider } from '@/lib/adapters/telephony';
import { messagingSenders } from '@/lib/domain/reception/channel-readiness';
import { availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCallPage, getCallCounts, callStatusLabel } from '@/lib/domain/reception/calls';
import { currentMembershipId, getInboxCounts, listInbox, type InboxFilter } from '@/lib/domain/reception/inbox';
import { listPhoneNumbers, resolveOutboundNumber } from '@/lib/domain/reception/numbers';
import { communicationsProviderReadiness } from '@/lib/domain/reception/provider-readiness';
import { listRoutes } from '@/lib/domain/reception/routing';
import { listCallOutcomes } from '@/lib/domain/reception/outcomes';
import { shiftDate, todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';

type Query = Record<string, string | string[] | undefined>;
export function communicationsParams(query: Query) {
  const first = (key: string) => { const value = query[key]; return Array.isArray(value) ? value[0] : value; };
  const when = first('when');
  const attention = first('attention');
  const queue = first('queue');
  const channel = first('channel');
  return {
    when: when === 'week' || when === 'month' ? when : 'today',
    attention: attention === 'unread' || attention === 'unassigned' || attention === 'wrap' || attention === 'routing' ? attention : 'missed',
    queue: queue === 'open' || queue === 'waiting' || queue === 'unassigned' ? queue : 'all',
    channel: channel === 'sms' || channel === 'email' ? channel : 'all',
    search: (first('q') ?? '').slice(0, 100).trim(),
  } as const;
}

export async function loadCommunicationsDashboard(db: Db, input: { organizationId: string; timezone: string; capabilities: readonly string[]; query: Query }) {
  const { organizationId, timezone, capabilities } = input;
  const params = communicationsParams(input.query);
  const mayCall = capabilities.includes('call.place');
  const mayMessage = capabilities.includes('message.send');
  const today = todayInZone(timezone);
  const day = zonedDayRange(today, timezone);
  const window = { since: zonedDayRange(shiftDate(today, params.when === 'week' ? -6 : params.when === 'month' ? -29 : 0), timezone).startsAt, until: day.endsAt };
  const [features, numbers, outbound, readiness, provider, senders, routes, outcomes, membershipId] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    listPhoneNumbers(db, { organizationId }),
    mayCall ? resolveOutboundNumber(db, { organizationId }) : null,
    communicationsProviderReadiness(db, { organizationId }),
    mayCall ? telephonyProvider() : null,
    mayMessage ? messagingSenders(db, { organizationId }) : { numbers: [], senders: [] },
    mayCall ? listRoutes(db, { organizationId }) : [],
    mayCall ? listCallOutcomes(db, { organizationId }) : [],
    mayMessage ? currentMembershipId(db, { organizationId }) : null,
  ]);
  const enabled = availableFeatureKeys(features);
  const canCall = mayCall && enabled.has('outbound_calling');
  const canEmail = mayMessage && senders.senders.length > 0;
  const callingReady = canCall && !!provider && !!callbackBase() && readiness === 'ready' && !!outbound;
  const smsNumbers = senders.numbers;
  const queueFilter: InboxFilter = { status: params.queue === 'open' || params.queue === 'waiting' ? params.queue : 'active', view: params.queue === 'unassigned' ? 'unassigned' : undefined, channel: params.channel === 'all' ? undefined : params.channel };
  const [counts, inboxCounts, calls, missed, wrap, queue, unread, unassigned, todayCalls, todayInbox, answered, recorded, recentCalls, recentInbox] = await Promise.all([
    mayCall ? getCallCounts(db, { organizationId, dayStart: day.startsAt, dayEnd: day.endsAt }) : null,
    mayMessage ? getInboxCounts(db, { organizationId, membershipId }) : null,
    mayCall ? listCallPage(db, { organizationId, filter: { ...window, search: params.search }, limit: 6 }) : null,
    mayCall ? listCallPage(db, { organizationId, filter: { ...window, state: 'missed' }, limit: 5 }) : null,
    mayCall ? listCallPage(db, { organizationId, filter: { needsWrapUp: true }, limit: 5 }) : null,
    mayMessage ? listInbox(db, { organizationId, membershipId, filter: { ...queueFilter, search: params.search }, limit: 6 }) : null,
    mayMessage ? listInbox(db, { organizationId, filter: { view: 'unread' }, limit: 5 }) : null,
    mayMessage ? listInbox(db, { organizationId, filter: { view: 'unassigned' }, limit: 5 }) : null,
    mayCall ? listCallPage(db, { organizationId, filter: { since: day.startsAt, until: day.endsAt }, limit: 5 }) : null,
    mayMessage ? listInbox(db, { organizationId, filter: { status: 'any', since: day.startsAt, until: day.endsAt }, limit: 5 }) : null,
    mayCall ? db.from('calls').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).gte('started_at', window.since).lt('started_at', window.until).not('answered_at', 'is', null) : null,
    mayCall ? db.from('calls').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).not('recording_available_at', 'is', null) : null,
    mayCall ? listCallPage(db, { organizationId, limit: 6 }) : null,
    mayMessage ? listInbox(db, { organizationId, filter: { status: 'any' }, limit: 6 }) : null,
  ]);
  for (const result of [answered, recorded]) if (result?.error) throw fromDatabaseError(result.error, 'communications.summary_failed');
  const base = `/organizations/${organizationId}`;
  const projectActivity = (callItems: NonNullable<typeof calls>['items'], inboxItems: NonNullable<typeof queue>['items']) => [
    ...callItems.map(call => ({ id: `call-${call.id}`, at: call.startedAt, title: `${call.direction === 'inbound' ? 'Incoming' : 'Outgoing'} call · ${callStatusLabel(call)}`, context: call.customerName ?? call.externalNumber ?? 'Withheld number', href: `${base}/calls/${call.id}`, channel: 'phone' as const })),
    ...inboxItems.map(item => ({ id: `conversation-${item.id}`, at: item.lastActivityAt, title: `${item.channel === 'email' ? 'Email' : 'SMS'} conversation activity`, context: item.title, href: `${base}/comms/inbox/${item.id}`, channel: item.channel })),
  ].sort((a,b) => b.at.localeCompare(a.at)).slice(0, 6);
  const activity = projectActivity(recentCalls?.items ?? [], recentInbox?.items ?? []);
  const todayActivity = projectActivity(todayCalls?.items ?? [], todayInbox?.items ?? []);
  return { params, today, window, mayCall, mayMessage, canCall, callingReady, canCompose: smsNumbers.length > 0 || canEmail, composeChannel: smsNumbers.length ? 'sms' : 'email', numbers, outbound, readiness, routes, outcomes, counts, inboxCounts, calls, missed, wrap, queue, unread, unassigned, activity, todayActivity, answered: answered?.count ?? 0, recorded: recorded?.count ?? 0 };
}

export type CommunicationsDashboard = Awaited<ReturnType<typeof loadCommunicationsDashboard>>;
