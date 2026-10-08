import type { Db } from '@/lib/db/types';
import {
  listAutomationRules,
  listAutomationRuns,
} from '@/lib/domain/automation/rules';
import { listMessageDeliveries } from '@/lib/domain/automation/templates';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import { getAutomationSummary } from '@/lib/domain/automation/monitoring';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import {
  shiftDate,
  todayInZone,
  zonedDayRange,
} from '@/lib/domain/scheduling/window';

export function automationPeriod(timezone: string, when?: string) {
  const days = when === 'today' ? 1 : when === 'month' ? 30 : 7;
  const today = todayInZone(timezone);
  const dates = Array.from({ length: days }, (_, i) =>
    shiftDate(today, i - days + 1),
  );
  return {
    when: days === 1 ? 'today' : days === 30 ? 'month' : 'week',
    dates,
    since: zonedDayRange(dates[0], timezone).startsAt,
    until: zonedDayRange(today, timezone).endsAt,
  };
}

export async function automationReviewContext(db: Db, organizationId: string) {
  const [rules, types] = await Promise.all([
    listAutomationRules(db, { organizationId }),
    listWorkItemTypes(db, { organizationId }),
  ]);
  const statuses = (
    await Promise.all(
      types.map(async (type) =>
        (
          await listWorkItemStatuses(db, { organizationId, typeId: type.id })
        ).map((status) => ({
          id: status.id,
          typeId: type.id,
          name: status.name,
          typeName: type.name,
          label: `${type.name} — ${status.name}`,
        })),
      ),
    )
  ).flat();
  const warnings = await reviewAutomationRules(db, {
    organizationId,
    rules,
    statuses,
    includeDisabled: true,
  });
  return { rules, types, statuses, warnings };
}

export async function loadAutomationDashboard(
  db: Db,
  input: { organizationId: string; timezone: string; when?: string },
) {
  const period = automationPeriod(input.timezone, input.when);
  const scope = {
    organizationId: input.organizationId,
    since: period.since,
    until: period.until,
  };
  const [context, summary, runs, deliveries, failedRuns, failedDeliveries] =
    await Promise.all([
      automationReviewContext(db, input.organizationId),
      getAutomationSummary(db, scope),
      listAutomationRuns(db, { ...scope, limit: 6 }),
      listMessageDeliveries(db, { ...scope, limit: 6 }),
      listAutomationRuns(db, { ...scope, failedOnly: true, limit: 5 }),
      listMessageDeliveries(db, { ...scope, failedOnly: true, limit: 5 }),
    ]);
  return {
    rules: context.rules,
    warnings: context.warnings,
    period,
    summary,
    runs,
    deliveries,
    failedRuns,
    failedDeliveries,
  };
}
export type AutomationDashboardData = Awaited<
  ReturnType<typeof loadAutomationDashboard>
>;
