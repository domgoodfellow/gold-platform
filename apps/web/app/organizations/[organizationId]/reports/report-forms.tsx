'use client';

import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import type { ReportDefinition } from '@/lib/domain/reporting/definitions';
import {
  MEASURE_LABELS,
  type Filters,
  type Grouping,
  type Measure,
  type PeriodPreset,
} from '@/lib/domain/reporting/shape';
import {
  createDashboardAction,
  deleteDashboardAction,
  deleteReportAction,
  saveReportAction,
  setPinAction,
  setReportRolesAction,
  type ReportState,
} from './actions';

const INITIAL: ReportState = { error: null };
/**
 * Saving what is currently on screen, and saying who it is for.
 *
 * **Every hidden field here is what the page was already showing.** A saved report is arguments
 * (D36), so saving one is naming the view rather than building anything — which is why there is
 * no builder on this screen and why the grouping, period and filters travel as they are.
 */
export function SaveReportForm({
  organizationId,
  measure,
  grouping,
  period,
  filters,
}: {
  organizationId: string;
  measure: Measure;
  grouping: Grouping;
  period: PeriodPreset;
  filters: Filters;
}) {
  const [state, formAction, pending] = useActionState(saveReportAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="measure" value={measure} />
      <input type="hidden" name="grouping" value={grouping} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="customer" value={filters.customerId ?? ''} />
      <input type="hidden" name="resource" value={filters.resourceId ?? ''} />
      <input type="hidden" name="location" value={filters.locationId ?? ''} />

      <SectionHeading>Keep this view</SectionHeading>
      <Hint>
        Saves what is on screen now — this grouping, this period and whatever it is narrowed to.
        Nothing is copied: the figures are worked out again each time somebody opens it.
      </Hint>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={120}
          placeholder="What you call this report"
          className="text-sm sm:flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

/** Which roles a saved report is for, and removing it. */
export function ReportAudienceForm({
  organizationId,
  report,
  roles,
  shared,
}: {
  organizationId: string;
  report: ReportDefinition;
  roles: { id: string; name: string }[];
  shared: string[];
}) {
  const [state, formAction, pending] = useActionState(setReportRolesAction, INITIAL);
  const [removal, removeAction, removing] = useActionState(deleteReportAction, INITIAL);

  return (
    <div className="py-3">
      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="reportId" value={report.id} />

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{report.name}</span>
          <span className="text-sm text-muted">
            {MEASURE_LABELS[report.measure].toLowerCase()} by {report.grouping},{' '}
            {report.period}
          </span>
        </div>

        {roles.length === 0 ? (
          <Hint>
            This business has one role, so there is nobody else to share with yet.
          </Hint>
        ) : (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {roles.map((role) => (
              <label key={role.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="roleId"
                  value={role.id}
                  defaultChecked={shared.includes(role.id)}
                />
                {role.name}
              </label>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={pending} tone="secondary" size="small">
            {pending ? 'Saving…' : 'Who sees this'}
          </Button>
        </div>

        <ErrorText>{state.error}</ErrorText>
      </form>

      {/*
        A second form rather than a second button in the first, because deleting is not a
        variation on sharing and a stray Enter must never remove a report somebody built a
        dashboard on.
      */}
      <form action={removeAction} className="mt-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="reportId" value={report.id} />
        <Button type="submit" disabled={removing} tone="text" size="small">
          {removing ? 'Removing…' : 'Remove this report'}
        </Button>
        <ErrorText>{removal.error}</ErrorText>
      </form>
    </div>
  );
}

/** Naming a new dashboard. The platform seeds none, including the four M7's source lists. */
export function CreateDashboardForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createDashboardAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="organizationId" value={organizationId} />
        <TextInput
          name="name"
          type="text"
          required
          maxLength={120}
          placeholder="What you call this dashboard"
          className="text-sm sm:flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Adding…' : 'Add a dashboard'}
        </Button>
      </div>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

/**
 * What is on one dashboard, and removing it.
 *
 * A checkbox per saved report, each its own small form, because pinning is one decision and a
 * page of tick boxes with a single Save is a page where somebody loses four changes to a stray
 * click on the fifth.
 */
export function DashboardContentsForm({
  organizationId,
  dashboard,
  reports,
  pinned,
}: {
  organizationId: string;
  dashboard: { id: string; name: string };
  reports: { id: string; name: string }[];
  pinned: string[];
}) {
  const [removal, removeAction, removing] = useActionState(deleteDashboardAction, INITIAL);

  return (
    <div className="py-3">
      <div className="font-medium">{dashboard.name}</div>

      {reports.length === 0 ? (
        <Hint className="mt-1">
          Save a report above and it can go on here.
        </Hint>
      ) : (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {reports.map((report) => (
            <li key={report.id}>
              <PinForm
                organizationId={organizationId}
                dashboardId={dashboard.id}
                report={report}
                pinned={pinned.includes(report.id)}
              />
            </li>
          ))}
        </ul>
      )}

      <form action={removeAction} className="mt-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="dashboardId" value={dashboard.id} />
        <Button type="submit" disabled={removing} tone="text" size="small">
          {removing ? 'Removing…' : 'Remove this dashboard'}
        </Button>
        <ErrorText>{removal.error}</ErrorText>
      </form>
    </div>
  );
}

function PinForm({
  organizationId,
  dashboardId,
  report,
  pinned,
}: {
  organizationId: string;
  dashboardId: string;
  report: { id: string; name: string };
  pinned: boolean;
}) {
  const [state, formAction, working] = useActionState(setPinAction, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <input type="hidden" name="reportId" value={report.id} />
      {/* What it is now, so the action knows which way to move it. */}
      <input type="hidden" name="pinned" value={pinned ? 'yes' : 'no'} />
      <Button type="submit" disabled={working} tone="text">
        {pinned ? 'Take off' : 'Put on'}
      </Button>
      <span className={pinned ? 'font-medium' : 'text-muted'}>{report.name}</span>
      {state.error ? (
        <span className="text-danger">{state.error}</span>
      ) : null}
    </form>
  );
}
