import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import {
  runReportDefinition,
  type ReportDefinition,
  type ReportResult,
} from '@/lib/domain/reporting/definitions';

/**
 * A dashboard: saved reports, in an order a business chose.
 *
 * **It holds no audience and needs none**. Who sees a dashboard follows from which of its
 * reports they can read — `dashboards_select` asks exactly that, with
 * `report_definitions_select` running inside the subquery under the caller's own rights. A
 * second role list here would be a second thing to keep in step, and the day the two disagreed
 * the answer would be whichever policy ran last.
 *
 * **Nothing in this file filters a tile.** A report a viewer may not read is not returned by the
 * database, so a tile disappears rather than rendering empty, and one dashboard shows different
 * people different things with nothing in application code deciding it. Adding a filter here
 * would be a second, weaker copy of the policy.
 */

export type Dashboard = {
  id: string;
  /** The business's own word for it. The platform seeds none, not even the four common ones. */
  name: string;
  createdAt: string;
};

/** One tile: a saved report and what it stands for right now. */
export type DashboardTile = {
  report: ReportDefinition;
  position: number;
  /** Whatever that report measures, discriminated — a tile of money and a tile of jobs. */
  result: ReportResult;
};

const NAME_MAX = 120;

function cleanName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new DomainError('A dashboard needs a name.', 'dashboards.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `A dashboard's name is at most ${NAME_MAX} characters.`,
      'dashboards.name_too_long',
    );
  }
  return name;
}

export async function listDashboards(
  db: Db,
  input: { organizationId: string },
): Promise<Dashboard[]> {
  const { data, error } = await db
    .from('dashboards')
    .select('id, name, created_at')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'dashboards.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
  }));
}

export async function createDashboard(
  db: Db,
  input: { organizationId: string; name: string },
): Promise<string> {
  await requireActor(db);
  const { data: user } = await db.auth.getUser();

  const { data, error } = await db
    .from('dashboards')
    .insert({
      organization_id: input.organizationId,
      name: cleanName(input.name),
      created_by: user.user!.id,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `You already have a dashboard called ${input.name.trim()}.`,
        'dashboards.name_taken',
      );
    }
    throw new DomainError(error.message, 'dashboards.create_failed');
  }

  return data.id;
}

export async function deleteDashboard(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db.from('dashboards').delete().eq('id', input.id);

  if (error) {
    throw new DomainError(error.message, 'dashboards.delete_failed');
  }
}

export async function pinReport(
  db: Db,
  input: {
    organizationId: string;
    dashboardId: string;
    reportId: string;
    position?: number;
  },
): Promise<void> {
  await requireActor(db);
  const { data: user } = await db.auth.getUser();

  const { error } = await db.from('dashboard_reports').insert({
    organization_id: input.organizationId,
    dashboard_id: input.dashboardId,
    report_id: input.reportId,
    position: input.position ?? 0,
    created_by: user.user!.id,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError('That report is already on this dashboard.', 'dashboards.pinned');
    }
    throw new DomainError(error.message, 'dashboards.pin_failed');
  }
}

export async function unpinReport(
  db: Db,
  input: { organizationId: string; dashboardId: string; reportId: string },
): Promise<void> {
  await requireActor(db);

  const { error } = await db
    .from('dashboard_reports')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('dashboard_id', input.dashboardId)
    .eq('report_id', input.reportId);

  if (error) {
    throw new DomainError(error.message, 'dashboards.unpin_failed');
  }
}

/**
 * What a dashboard shows this caller, right now.
 *
 * **Each tile is `runReportDefinition`**, so a dashboard is one more caller of whichever
 * aggregate that report names and never a query of its own. The reports it can
 * see are whatever `dashboard_reports_select` returned, which is the audience doing its work;
 * a viewer with access to two of five pinned reports gets two tiles and is told nothing about
 * the other three.
 */
export async function readDashboard(
  db: Db,
  input: { organizationId: string; dashboardId: string; today: string },
): Promise<DashboardTile[]> {
  const { data, error } = await db
    .from('dashboard_reports')
    .select(
      'position, report:report_definitions!dashboard_reports_report_same_org (id, name, measure, grouping, period, customer_id, resource_id, location_id, created_at)',
    )
    .eq('organization_id', input.organizationId)
    .eq('dashboard_id', input.dashboardId)
    .order('position', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'dashboards.read_failed');
  }

  const pinned = (data ?? []).flatMap((row) => {
    const report = Array.isArray(row.report) ? row.report[0] : row.report;
    // A pin whose report this caller may not read comes back with nothing joined. Dropped
    // rather than rendered as a gap: the point of the audience is that the tile is absent.
    if (!report) return [];

    return [
      {
        position: row.position,
        report: {
          id: report.id,
          name: report.name,
          measure: report.measure,
          grouping: report.grouping,
          period: report.period,
          filters: {
            customerId: report.customer_id,
            resourceId: report.resource_id,
            locationId: report.location_id,
          },
          createdAt: report.created_at,
        } as ReportDefinition,
      },
    ];
  });

  return Promise.all(
    pinned.map(async (tile) => ({
      ...tile,
      result: await runReportDefinition(db, {
        organizationId: input.organizationId,
        definition: tile.report,
        today: input.today,
      }),
    })),
  );
}
