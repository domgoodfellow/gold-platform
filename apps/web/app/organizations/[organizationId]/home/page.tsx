import { HomeDashboard, type HomeData } from '@/features/home/home-dashboard';
import { listAutomationRuns } from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import {
  availableFeatureKeys,
  organizationResolvedFeatureStates,
  activeModuleKeys,
} from '@/lib/domain/catalogue/organization-plans';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listCalls } from '@/lib/domain/reception/calls';
import { listInvoicedAndIncurred, totalsByCurrency } from '@/lib/domain/reporting/financials';
import { PERIOD_LABELS, periodFor } from '@/lib/domain/reporting/shape';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { listRecentActivity } from '@/lib/domain/timeline/timeline';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { areaAvailable } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Home acquires; `HomeDashboard` draws. A block is read only when the same predicate that decides
 * whether its workspace appears in navigation (`areaAvailable`) says this
 * organization has it — so Home and the sidebar cannot disagree about what a business has, and no
 * query runs for a capability the business does not hold. Every figure comes from a domain read
 * that already owns it; nothing is totalled here.
 */
export default async function HomePage({ params }: PageProps<'/organizations/[organizationId]/home'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const date = todayInZone(organization.timezone);
  const within = zonedDayRange(date, organization.timezone);

  const featureStates = await organizationResolvedFeatureStates(db, { organizationId });
  const modules = activeModuleKeys(featureStates);
  const features = availableFeatureKeys(featureStates);
  const capabilities = new Set(organization.capabilities);
  const has = (segment: string) => areaAvailable(segment, { enabled: modules, capabilities, featureAvailability: features });
  const hasCommunications = has('calls');
  const hasAutomation = has('automations');
  const hasFinancials = has('insights') && capabilities.has('report.read');
  const period = periodFor('month', date);

  const [schedule, workItems, customers, activity, calls, failedRuns, failedMessages, invoiced] = await Promise.all([
    listSchedule(db, { organizationId, within, on: { date, timeZone: organization.timezone } }),
    listWorkItems(db, { organizationId }),
    listCustomers(db, { organizationId, limit: 1 }),
    listRecentActivity(db, { organizationId, limit: 12 }),
    hasCommunications ? listCalls(db, { organizationId }) : Promise.resolve(null),
    hasAutomation ? listAutomationRuns(db, { organizationId, failedOnly: true }) : Promise.resolve(null),
    hasAutomation ? listMessageDeliveries(db, { organizationId, failedOnly: true }) : Promise.resolve(null),
    hasFinancials
      ? listInvoicedAndIncurred(db, { organizationId, grouping: 'customer', period })
      : Promise.resolve(null),
  ]);

  const committed = schedule
    .flatMap((entry) => entry.booked.map((booking) => ({ ...booking, resource: entry.resource.name })))
    .sort((a, b) => a.window.startsAt.localeCompare(b.window.startsAt));
  const todaysCalls = calls?.filter((call) => call.startedAt >= within.startsAt && call.startedAt < within.endsAt) ?? [];
  const totals = invoiced ? totalsByCurrency(invoiced) : [];

  const data: HomeData = {
    organizationId,
    timezone: organization.timezone,
    date,
    customers: { total: customers.total },
    work: {
      total: workItems.total,
      // A count of what is waiting is only true of the whole list when the whole list was read.
      waiting: workItems.total > workItems.length ? null : workItems.filter((item) => item.window === null),
    },
    schedule: { committed, byId: new Map(workItems.map((item) => [item.id, item])) },
    communications: calls
      ? { today: todaysCalls.length, unwritten: todaysCalls.filter((call) => call.outcome === null).length }
      : null,
    automation: failedRuns && failedMessages ? { failedRuns, failedMessages } : null,
    financials: invoiced && totals.length > 0 ? { period: PERIOD_LABELS.month.toLowerCase(), totals } : null,
    activity,
  };

  return <HomeDashboard data={data} />;
}
