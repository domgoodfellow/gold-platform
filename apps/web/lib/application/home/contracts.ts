import { shiftDate, startOfMonth, shiftMonth, zonedDayRange } from '@/lib/domain/scheduling/window';

export type HomeSource = 'CRM' | 'Communications' | 'Marketing' | 'Support' | 'Work' | 'Finance' | 'Automations' | 'AI' | 'Studio';
export type HomeQuery = { when: 'today' | 'week' | 'month'; scope: 'organization' | 'mine'; attention: 'all' | 'urgent' | 'overdue' };
export function homeQuery(query: Record<string, string | string[] | undefined>): HomeQuery {
  return { when: query.when === 'week' || query.when === 'month' ? query.when : 'today', scope: query.scope === 'mine' ? 'mine' : 'organization', attention: query.attention === 'urgent' || query.attention === 'overdue' ? query.attention : 'all' };
}
export function homePeriod(date: string, timezone: string, when: HomeQuery['when']) {
  const from = when === 'month' ? startOfMonth(date) : when === 'week' ? shiftDate(date, -6) : date;
  const to = when === 'month' ? shiftMonth(from, 1) : shiftDate(date, 1);
  return { from, to, since: zonedDayRange(from, timezone).startsAt, until: zonedDayRange(to, timezone).startsAt };
}
export type HomeAttentionItem = {
  key: string; organizationId: string; source: HomeSource; category: string; title: string; description: string;
  urgency: 'critical' | 'high' | 'normal'; occurredAt?: string; dueAt?: string;
  ownerMembershipId?: string | null; ownerName?: string | null; overdue: boolean;
  record: { kind: string; id: string }; destination: { href: string; label: string };
};
export type HomeCategory = { key: string; label: string; total: number; href: string };
export type HomeMetric = { key: string; label: string; value: number | string; definition: string; href: string };
export type HomeObligation = { key: string; source: HomeSource; title: string; at: string; context: string; owner: string; href: string };
export type HomeActivity = { key: string; source: HomeSource; title: string; at: string; href: string; actor?: string | null };
export type HomeHealth = { key: string; source: HomeSource; state: string; detail: string; href: string; warning: boolean };
export type HomeSourceData = {
  source: HomeSource; metrics: HomeMetric[]; categories: HomeCategory[]; attention: HomeAttentionItem[];
  today: HomeObligation[]; upcoming: HomeObligation[]; priorities: HomeAttentionItem[];
  activity: HomeActivity[]; performance: HomeMetric[]; health: HomeHealth[];
  trends: { currency: string; points: { day: string; amountMinor: number }[] }[];
};
export type HomeResult = { source: HomeSource; state: 'ready'; data: HomeSourceData } | { source: HomeSource; state: 'unavailable' };
export type HomeData = {
  organizationId: string; membershipId: string | null; date: string; timezone: string; refreshedAt: string;
  query: HomeQuery; period: ReturnType<typeof homePeriod>; results: HomeResult[]; kpis: HomeMetric[];
  quickActions: { key: string; label: string; href: string; description: string }[];
  search: { label: string; href: string }[]; agentPrompts: string[];
};
export const emptySource = (source: HomeSource): HomeSourceData => ({ source, metrics: [], categories: [], attention: [], today: [], upcoming: [], priorities: [], activity: [], performance: [], health: [], trends: [] });

export function prioritize(items: HomeAttentionItem[], dayEnd: string): HomeAttentionItem[] {
  const rank = (item: HomeAttentionItem) => item.overdue ? item.urgency === 'critical' ? 0 : item.urgency === 'high' ? 1 : 2 : item.urgency === 'critical' ? 3 : item.urgency === 'high' ? 4 : item.dueAt && item.dueAt < dayEnd ? 5 : !item.ownerMembershipId && item.category.includes('unassigned') ? 6 : 7;
  const unique = new Map<string, HomeAttentionItem>();
  for (const item of items) {
    const previous = unique.get(item.key);
    if (!previous || rank(item) < rank(previous)) unique.set(item.key, item);
  }
  return [...unique.values()].sort((a, b) => rank(a) - rank(b) || (a.dueAt ?? a.occurredAt ?? '').localeCompare(b.dueAt ?? b.occurredAt ?? '') || a.key.localeCompare(b.key));
}
