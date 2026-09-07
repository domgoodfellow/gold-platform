import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  listOperatingHours,
  openWindows,
  type OperatingHours,
} from '@/lib/domain/scheduling/operating-hours';
import { parseWindow, type Window } from '@/lib/domain/scheduling/window';

/**
 * **The** availability calculation (I5) — anything that wants to know what's free calls
 * `freeWindows` or `listSchedule`; nothing recomputes. Advisory only (I6): every answer is a
 * snapshot the world may already have invalidated, and the real check is
 * `work_items_resource_not_double_booked` refusing the commit in the same transaction —
 * `scheduleWorkItem` deliberately doesn't call this first. Operating hours are subtracted first
 * and are entirely the tenant's: no default working week exists, so a business with none
 * configured is treated as always open.
 */

/** A resource's day: what it is committed to, and what is left. */
export type ResourceSchedule = {
  resource: { id: string; name: string };
  booked: {
    workItemId: string;
    title: string;
    /** The appointment — what the customer was told, and the only one ever rendered. */
    window: Window;
    /** The appointment plus the tenant's buffer — what `free` is actually computed against. */
    occupied: Window;
  }[];
  free: Window[];
};

const MINUTE = 60_000;

function lengthMs(window: Window): number {
  return new Date(window.endsAt).getTime() - new Date(window.startsAt).getTime();
}

/** Pure and separately tested — this is the part with the arithmetic. Windows are half-open throughout: back-to-back work leaves no gap. */
export function freeWindows(
  within: Window,
  busy: Window[],
  options: { minimumMinutes?: number } = {},
): Window[] {
  const minimum = (options.minimumMinutes ?? 0) * MINUTE;

  // Sorted and merged first — this function is also asked "when is *anyone* free" across
  // resources, and can't rely on one tenant's exclusion constraint there.
  const merged: Window[] = [];
  for (const window of [...busy].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    const last = merged[merged.length - 1];
    if (last && window.startsAt <= last.endsAt) {
      if (window.endsAt > last.endsAt) last.endsAt = window.endsAt;
    } else {
      merged.push({ ...window });
    }
  }

  const free: Window[] = [];
  let cursor = within.startsAt;

  for (const window of merged) {
    if (window.endsAt <= within.startsAt) continue;
    if (window.startsAt >= within.endsAt) break;

    if (window.startsAt > cursor) {
      free.push({ startsAt: cursor, endsAt: window.startsAt });
    }
    if (window.endsAt > cursor) cursor = window.endsAt;
  }

  if (cursor < within.endsAt) {
    free.push({ startsAt: cursor, endsAt: within.endsAt });
  }

  return free.filter((window) => lengthMs(window) >= minimum && lengthMs(window) > 0);
}

/** Two reads under RLS — the tenant's resources, and work already committed in range. `organization_id` filters are optimisations; RLS is the boundary. */
export async function listSchedule(
  db: Db,
  input: {
    organizationId: string;
    within: Window;
    minimumMinutes?: number;
    /** Given together or not at all — an hours rule needs both to resolve to instants. Omitted, the whole range is treated as open, same as an empty hours set. */
    on?: { date: string; timeZone: string };
  },
): Promise<ResourceSchedule[]> {
  const range = `[${input.within.startsAt},${input.within.endsAt})`;

  const [resources, committed, hours] = await Promise.all([
    db
      .from('resources')
      .select('id, name')
      .eq('organization_id', input.organizationId)
      .order('name', { ascending: true }),
    db
      // `occupies` is what the resource is unavailable for (appointment plus buffer);
      // `scheduled_during` is what the customer was told.
      .from('work_items')
      .select('id, title, resource_id, scheduled_during, occupies')
      .eq('organization_id', input.organizationId)
      .not('resource_id', 'is', null)
      // These three filters mirror the exclusion constraint's partial predicate exactly — a
      // clause added to one without the other would turn a free window into an unbookable one, or the reverse.
      .eq('status_releases_resource', false)
      .overlaps('occupies', range),
    input.on
      ? listOperatingHours(db, { organizationId: input.organizationId })
      : Promise.resolve([] as OperatingHours[]),
  ]);

  if (resources.error) {
    throw new DomainError(resources.error.message, 'availability.resources_failed');
  }
  if (committed.error) {
    throw new DomainError(committed.error.message, 'availability.committed_failed');
  }

  // The business's open periods, or the whole range if it has not said. Computed once, since hours are the organization's, not per resource.
  const open = input.on
    ? openWindows(input.on.date, input.on.timeZone, hours, input.within)
    : [input.within];

  const byResource = new Map<string, ResourceSchedule['booked']>();
  for (const row of committed.data ?? []) {
    // `supabase gen types` has no TypeScript for a Postgres range (D15).
    const window = parseWindow(row.scheduled_during as string | null);
    const occupied = parseWindow(row.occupies as string | null);
    if (!window || !occupied || !row.resource_id) continue;

    const existing = byResource.get(row.resource_id) ?? [];
    existing.push({ workItemId: row.id, title: row.title, window, occupied });
    byResource.set(row.resource_id, existing);
  }

  return (resources.data ?? []).map((resource) => {
    const booked = (byResource.get(resource.id) ?? []).sort((a, b) =>
      a.window.startsAt.localeCompare(b.window.startsAt),
    );

    return {
      resource: { id: resource.id, name: resource.name },
      booked,
      free: open.flatMap((window) =>
        freeWindows(
          window,
          // The occupied windows, not the appointments — subtracting the appointment would
          // offer a slot the constraint then refuses.
          booked.map((entry) => entry.occupied),
          { minimumMinutes: input.minimumMinutes },
        ),
      ),
    };
  });
}
