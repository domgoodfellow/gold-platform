import { ViewNav } from '@/components/containers/view-nav';
import { scheduleHref, type ScheduleView } from './schedule-url';

/**
 * Schedule's two sibling views. Both routes to the same page under a different `view`, so
 * switching keeps the selected date and resource filters — the same URL-is-the-state contract
 * `scheduleHref` gives every other Schedule control.
 */
export function ScheduleViewNav({
  organizationId,
  view,
  date,
  resourceIds,
}: {
  organizationId: string;
  view: ScheduleView;
  date: string;
  resourceIds: readonly string[];
}) {
  return (
    <ViewNav
      label="Schedule views"
      current={view}
      views={[
        { key: 'day', label: 'Day', href: scheduleHref(organizationId, { view: 'day', date, resourceIds }) },
        { key: 'week', label: 'Week', href: scheduleHref(organizationId, { view: 'week', date, resourceIds }) },
      ]}
    />
  );
}
