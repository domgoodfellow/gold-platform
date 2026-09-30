import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppPage } from '@/components/layout/app-page';
import { Card } from '@/components/surfaces/card';
import { KpiCard, type Kpi } from '@/components/surfaces/kpi-card';
import { PageHeader } from '@/components/headers/page-header';
import { DividedList, EmptyState, SectionHeading } from '@/components/surfaces/section';
import { cx, FOCUS_RING } from '@/components/class-names';
import { Badge } from '@/components/display/data';
import { ActivityList } from '@/features/timeline/activity-list';
import type { AutomationRun } from '@/lib/domain/automation/rules';
import type { MessageDelivery } from '@/lib/domain/automation/templates';
import type { PeriodTotal } from '@/lib/domain/reporting/financials';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { formatWindow, type Window } from '@/lib/domain/scheduling/window';
import type { TimelineEntry } from '@/lib/domain/timeline/timeline';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import { areaHref, areaLabel } from '@/lib/navigation';

const PREVIEW = 6;

type Commitment = { workItemId: string; title: string; window: Window; occupied: Window; resource: string };

/**
 * What one block of Home may read. A block is **absent** (`null`) when its capability is not
 * entitled to this organization or the role cannot read it — never present-and-zero. Home draws a
 * block from a value somebody else computed; it computes none (I4, I5).
 */
export type HomeData = {
  organizationId: string;
  timezone: string;
  /** The organization's own calendar date. Formatting it must not shift it again. */
  date: string;
  customers: { total: number };
  work: {
    total: number;
    /** Null when the list was truncated, because a count taken from a partial list is a wrong count. */
    waiting: WorkItem[] | null;
  };
  schedule: { committed: Commitment[]; byId: Map<string, WorkItem> };
  communications: { today: number; unwritten: number } | null;
  automation: { failedRuns: AutomationRun[]; failedMessages: MessageDelivery[] } | null;
  /** This month's invoiced and incurred, per currency — the reporting aggregate's own totals. Null when reporting is not available to this reader. */
  financials: { period: string; totals: PeriodTotal[] } | null;
  activity: TimelineEntry[];
};

function formatBusinessDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

function Panel({ title, href, hrefLabel, className, children }: { title: string; href?: string; hrefLabel?: string; className?: string; children: ReactNode }) {
  return (
    <Card as="section" className={cx('flex flex-col', className)}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <SectionHeading>{title}</SectionHeading>
        {href ? (
          <Link href={href} className={cx('shrink-0 rounded text-sm text-muted underline-offset-4 hover:underline', FOCUS_RING)}>
            {hrefLabel ?? 'Open'}
          </Link>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </Card>
  );
}

/**
 * Home: what matters in this organization right now. A dashboard, not a list page — figures first,
 * then the two panels an operator acts from, then what recently changed. Every figure is read from
 * the domain aggregate that owns it (see `app/organizations/[organizationId]/home/page.tsx`); a
 * block whose source is not available to this organization is not drawn at all.
 */
export function HomeDashboard({ data, readiness }: { data: HomeData; readiness?: ReactNode }) {
  const { organizationId, timezone } = data;
  const href = (segment: string) => areaHref(organizationId, segment);
  const workHref = (id: string) => `${href('work')}/${id}`;

  const operationalEmpty =
    data.customers.total === 0 &&
    data.work.total === 0 &&
    data.schedule.committed.length === 0;

  const kpis: Kpi[] = [];
  if (!operationalEmpty) {
    kpis.push({ key: 'customers', label: areaLabel('customers'), value: data.customers.total, href: href('customers') });
    kpis.push({ key: 'work', label: areaLabel('work'), value: data.work.total, note: 'jobs recorded', href: href('work') });
    kpis.push({ key: 'schedule', label: 'Scheduled today', value: data.schedule.committed.length, href: href('schedule') });
  }
  if (data.communications && (data.communications.today > 0 || !operationalEmpty)) {
    kpis.push({
      key: 'calls',
      label: 'Calls today',
      value: data.communications.today,
      note: data.communications.unwritten ? `${data.communications.unwritten} not written up` : undefined,
      href: href('calls'),
    });
  }
  const failures = data.automation ? data.automation.failedRuns.length + data.automation.failedMessages.length : 0;
  if (data.automation && failures > 0) {
    kpis.push({ key: 'automation', label: 'Automation failures', value: failures, note: 'runs and messages', href: href('automations') });
  }
  if (data.financials) {
    for (const total of data.financials.totals) {
      kpis.push({
        key: `invoiced-${total.currency}`,
        label: `Invoiced ${data.financials.period}`,
        value: formatMoney(total.invoicedMinor, total.currency),
        // Margin only where the aggregate defines one — a null is left unsaid, never shown as zero.
        note: total.marginMinor === null ? total.currency : `${formatMoney(total.marginMinor, total.currency)} margin`,
        href: `${href('insights')}/reports`,
      });
    }
  }

  const waiting = data.work.waiting ?? [];
  const attention = [
    ...(data.automation?.failedRuns ?? []).map((run) => ({ key: `run-${run.id}`, title: run.ruleName, detail: run.detail })),
    ...(data.automation?.failedMessages ?? []).map((message) => ({ key: `message-${message.id}`, title: `${message.channel} to ${message.recipient}`, detail: message.detail })),
  ];

  return (
    <AppPage>
      <PageHeader
        title={areaLabel('home')}
        description={<><time dateTime={data.date}>{formatBusinessDate(data.date)}</time> · {timezone}</>}
      />

      <div className="flex flex-col gap-4">
          {readiness}
          {kpis.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
          </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Scheduled today" href={href('schedule')} hrefLabel="Open schedule" className="lg:col-span-2">
              {data.schedule.committed.length === 0 ? (
                <EmptyState weight="subtle">Nothing is scheduled today.</EmptyState>
              ) : (
                <DividedList className="text-sm">
                  {data.schedule.committed.slice(0, PREVIEW).map((row) => {
                    const item = data.schedule.byId.get(row.workItemId);
                    return (
                      <li key={row.workItemId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                        <span className="w-28 shrink-0 tabular-nums text-muted">{formatWindow(row.window, timezone)}</span>
                        <Link href={workHref(row.workItemId)} className={cx('min-w-0 truncate rounded underline underline-offset-4', FOCUS_RING)}>{row.title}</Link>
                        {item ? <Badge>{item.status.label}</Badge> : null}
                        <span className="ml-auto shrink-0 text-muted">{row.resource}</span>
                      </li>
                    );
                  })}
                </DividedList>
              )}
            </Panel>

            <Panel title="Needs attention" href={waiting.length > 0 ? href('work') : undefined} hrefLabel="Open work">
              {waiting.length === 0 && attention.length === 0 ? (
                <EmptyState weight="subtle">Nothing needs attention.</EmptyState>
              ) : (
                <DividedList className="text-sm">
                  {waiting.slice(0, PREVIEW).map((item) => (
                    <li key={item.id} className="py-2">
                      <Link href={workHref(item.id)} className={cx('block truncate rounded underline underline-offset-4', FOCUS_RING)}>{item.title}</Link>
                      <span className="text-xs text-muted">Waiting to be scheduled{item.customer ? ` · ${item.customer.label}` : ''}</span>
                    </li>
                  ))}
                  {attention.slice(0, PREVIEW).map((entry) => (
                    <li key={entry.key} className="py-2">
                      <Link href={href('automations')} className={cx('block truncate rounded underline underline-offset-4', FOCUS_RING)}>{entry.title}</Link>
                      <span className="block truncate text-xs text-muted">Failed{entry.detail ? ` · ${entry.detail}` : ''}</span>
                    </li>
                  ))}
                </DividedList>
              )}
            </Panel>
          </div>

          <Panel title="Recent activity">
            <ActivityList timeline={data.activity.slice(0, PREVIEW)} timezone={timezone} emptyMessage="No activity yet." />
          </Panel>
        </div>
    </AppPage>
  );
}
