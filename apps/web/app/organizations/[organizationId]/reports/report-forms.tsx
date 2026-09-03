'use client';

import { useActionState } from 'react';
import type { ReportDefinition } from '@/lib/domain/reporting/definitions';
import type { Filters, Grouping, PeriodPreset } from '@/lib/domain/reporting/financials';
import {
  deleteReportAction,
  saveReportAction,
  setReportRolesAction,
  type ReportState,
} from './actions';

const INITIAL: ReportState = { error: null };
const FIELD = 'rounded border border-black/15 px-3 py-2 text-sm dark:border-white/20';
const BUTTON = 'rounded border border-black/15 px-3 py-1 text-sm dark:border-white/20';

/**
 * Saving what is currently on screen, and saying who it is for.
 *
 * **Every hidden field here is what the page was already showing.** A saved report is arguments
 * (D36), so saving one is naming the view rather than building anything — which is why there is
 * no builder on this screen and why the grouping, period and filters travel as they are.
 */
export function SaveReportForm({
  organizationId,
  grouping,
  period,
  filters,
}: {
  organizationId: string;
  grouping: Grouping;
  period: PeriodPreset;
  filters: Filters;
}) {
  const [state, formAction, pending] = useActionState(saveReportAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="grouping" value={grouping} />
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="customer" value={filters.customerId ?? ''} />
      <input type="hidden" name="resource" value={filters.resourceId ?? ''} />
      <input type="hidden" name="location" value={filters.locationId ?? ''} />

      <h2 className="text-sm font-medium">Keep this view</h2>
      <p className="text-sm opacity-70">
        Saves what is on screen now — this grouping, this period and whatever it is narrowed to.
        Nothing is copied: the figures are worked out again each time somebody opens it.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          type="text"
          required
          maxLength={120}
          placeholder="What you call this report"
          className={`${FIELD} sm:flex-1`}
        />
        <button type="submit" disabled={pending} className={BUTTON}>
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>

      {state.error ? <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p> : null}
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
          <span className="text-sm opacity-70">
            by {report.grouping}, {report.period}
          </span>
        </div>

        {roles.length === 0 ? (
          <p className="text-sm opacity-70">
            This business has one role, so there is nobody else to share with yet.
          </p>
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
          <button type="submit" disabled={pending} className={BUTTON}>
            {pending ? 'Saving…' : 'Who sees this'}
          </button>
        </div>

        {state.error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{state.error}</p>
        ) : null}
      </form>

      {/*
        A second form rather than a second button in the first, because deleting is not a
        variation on sharing and a stray Enter must never remove a report somebody built a
        dashboard on.
      */}
      <form action={removeAction} className="mt-2">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="reportId" value={report.id} />
        <button type="submit" disabled={removing} className="text-sm underline opacity-70">
          {removing ? 'Removing…' : 'Remove this report'}
        </button>
        {removal.error ? (
          <p className="text-sm text-red-700 dark:text-red-400">{removal.error}</p>
        ) : null}
      </form>
    </div>
  );
}
