import { prioritize, type HomeData, type HomeObligation } from './contracts';
import { zonedDayRange, shiftDate } from '@/lib/domain/scheduling/window';

/** Presentation precedence only: source reads own totals, permissions, urgency and commitments. */
export function homePresentation(data: HomeData) {
  const sources = data.results.flatMap(result => result.state === 'ready' ? [result.data] : []);
  const attention = prioritize(sources.flatMap(source => source.attention), zonedDayRange(data.date, data.timezone).endsAt)
    .filter(row => data.query.attention === 'overdue' ? row.overdue : data.query.attention === 'urgent' ? row.urgency !== 'normal' : true);
  const used = new Set(attention.map(row => row.key));
  const mine = prioritize(sources.flatMap(source => source.priorities), zonedDayRange(data.date, data.timezone).endsAt)
    .filter(row => !used.has(row.key)).slice(0, 3);
  for (const row of mine) used.add(row.key);
  const order = (a: HomeObligation, b: HomeObligation) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key);
  const todayIds = new Set(sources.flatMap(source => source.today).map(row => row.key));
  const today = [...new Map(sources.flatMap(source => source.today).map(row => [row.key, row])).values()].filter(row => !used.has(row.key)).sort(order);
  const upcoming = [...new Map(sources.flatMap(source => source.upcoming).map(row => [row.key, row])).values()].filter(row => !todayIds.has(row.key) && !used.has(row.key)).sort(order);
  for (const row of [...today.slice(0, 8), ...upcoming.slice(0, 8)]) used.add(row.key);
  const latest = new Map<string, typeof sources[number]['activity'][number]>();
  for (const row of sources.flatMap(source => source.activity).sort((a, b) => b.at.localeCompare(a.at) || a.key.localeCompare(b.key))) {
    const key = row.recordKey ?? row.key;
    if ((!row.recordKey || !used.has(row.recordKey)) && !latest.has(key)) latest.set(key, row);
  }
  const activity = [...latest.values()].slice(0, 6);
  return { sources, attention, mine, today, upcoming, activity,
    boundedChecks: sources.flatMap(source => source.health).filter(health => health.key === 'deployments-more'),
    categories: sources.flatMap(source => source.categories).filter(category => category.total > 0),
    performance: sources.flatMap(source => source.performance),
    upcomingLabel: `${shiftDate(data.date, 1)} – ${shiftDate(data.date, 7)}`,
  };
}
