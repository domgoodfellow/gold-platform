import Link from 'next/link';
import type { CSSProperties } from 'react';
import { formatWindow, type Window } from '@/lib/domain/scheduling/window';

/**
 * One booked appointment, linking straight to the Work item it belongs to — the one event
 * component Day and Week both render, so a booking never says something different depending on
 * which view drew it. `block` is Day's absolutely-positioned lane entry; `row` is Week's agenda
 * line. Neither carries more than a dispatcher needs to recognise the job and open it — the
 * record detail stays on Work.
 */
export function ScheduleEvent({
  organizationId,
  workItemId,
  title,
  window,
  displayWindow,
  resourceName,
  timezone,
  variant = 'row',
  style,
}: {
  organizationId: string;
  workItemId: string;
  title: string;
  /** The canonical appointment — record truth, and what the full description reads from. */
  window: Window;
  /**
   * What to show for *this* day, when it differs from `window` — a booking spanning midnight
   * clipped to the tenant calendar day it is being drawn on, so the visible time never reads as
   * the previous day's start. Defaults to `window` for every booking that doesn't cross a day.
   */
  displayWindow?: Window;
  /** Shown in Week's agenda row, where there is no per-resource column to say it instead. */
  resourceName?: string;
  timezone: string;
  variant?: 'row' | 'block';
  style?: CSSProperties;
}) {
  const shown = displayWindow ?? window;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(
    new Date(shown.startsAt),
  );
  const fullDescription = `${title}, ${formatWindow(window, timezone)}${resourceName ? `, ${resourceName}` : ''}`;
  const href = `/organizations/${organizationId}/work/${workItemId}`;

  if (variant === 'block') {
    return (
      <Link
        href={href}
        style={style}
        className="absolute inset-x-0.5 overflow-hidden rounded bg-foreground px-1.5 py-1 text-xs leading-tight text-background hover:opacity-90"
      >
        <span className="sr-only">{fullDescription}</span>
        <span aria-hidden className="block truncate font-medium">
          {title}
        </span>
        <span aria-hidden className="block truncate tabular-nums opacity-80">
          {time}
        </span>
      </Link>
    );
  }

  return (
    <Link href={href} className="block rounded border border-border px-2 py-1.5 text-xs hover:bg-hover">
      <span className="sr-only">{fullDescription}</span>
      <span aria-hidden className="block tabular-nums text-muted">
        {time}
      </span>
      <span aria-hidden className="block truncate font-medium">
        {title}
      </span>
      {resourceName ? (
        <span aria-hidden className="block truncate text-muted">
          {resourceName}
        </span>
      ) : null}
    </Link>
  );
}
