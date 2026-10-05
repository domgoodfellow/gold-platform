import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  listOperatingHours,
  openWindows,
} from '@/lib/domain/scheduling/operating-hours';
import {
  listAvailabilityConflicts,
  listResourceAvailabilityExceptions,
  listResourceOpenWindows,
  type AvailabilityConflict,
  type AvailabilityProblem,
  type ResourceAvailabilityException,
} from '@/lib/domain/scheduling/resource-availability';
import { clipWindow, overlaps, parseWindow, zonedDayRange, type Window } from '@/lib/domain/scheduling/window';

/**
 * **The** availability calculation (I5) — anything that wants to know what's free calls
 * `freeWindows` or `listSchedule`/`listScheduleDays`; nothing recomputes. Advisory only (I6):
 * every answer is a snapshot the world may already have invalidated, and the real check is
 * `work_items_resource_not_double_booked` refusing the commit in the same transaction —
 * `scheduleWorkItem` deliberately doesn't call this first. Operating hours are subtracted first
 * and are entirely the tenant's: no default working week exists, so a business with none
 * configured is treated as always open.
 *
 * What a resource is *open* for — organization hours ∩ its own working hours − its exceptions — is
 * read from `listResourceOpenWindows` and never computed here; this file subtracts commitments from
 * it. open is when it is expected to work, free is open with commitments removed.
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
    /** Everyone on this work item, this resource included. One work item, one window, however many take part. */
    resourceIds: string[];
    /** The kind of work it is — what a requirement is read against. */
    typeId: string;
    /** Set when this work now sits outside this resource's hours or over its time off. Flagged, never moved. */
    availabilityProblem: AvailabilityProblem | null;
  }[];
  /** When this resource is expected to work: organization hours ∩ its own hours − its exceptions, commitments not removed. */
  open: Window[];
  /** The time off and maintenance overlapping the range, so a screen can say *why* it is not working. */
  exceptions: ResourceAvailabilityException[];
  free: Window[];
};

/** Scheduled work with nobody assigned: it has a time and consumes no resource's capacity, so no lane holds it. */
export type UnassignedWork = {
  workItemId: string;
  title: string;
  window: Window;
  typeId: string;
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

type CommittedRow = {
  id: string;
  type_id: string;
  title: string;
  scheduled_during: string | null;
  occupies: string | null;
  /** Who takes part. Embedded from `work_item_resource_assignments`, the only answer to that. */
  assignments: { resource_id: string }[] | null;
};

/**
 * The one select for "what is committed in this range" — work items that are not in a releasing
 * status, with who is on each. Assigned work becomes bookings in each of its resources' lanes;
 * work with nobody on it is what `unassignedFrom` returns. The two filters mirror the exclusion
 * constraint's partial predicate exactly, and a clause added to one without the other would turn a
 * free window into an unbookable one, or the reverse.
 */
const COMMITTED_SELECT =
  'id, type_id, title, scheduled_during, occupies, assignments:work_item_resource_assignments!work_item_resource_assignments_work_item_same_org (resource_id)';


/**
 * The raw committed rows, grouped by resource and parsed into windows — the one place a
 * `work_items` row becomes a `ResourceSchedule['booked']` entry. Shared by `listSchedule` and
 * `listScheduleDays` so there is one reading of "what is this resource committed to", not two.
 */
function groupBookedByResource(
  rows: CommittedRow[],
  conflicts: AvailabilityConflict[] = [],
): Map<string, ResourceSchedule['booked']> {
  const problems = new Map(conflicts.map((c) => [`${c.workItemId}:${c.resourceId}`, c.problem]));
  const byResource = new Map<string, ResourceSchedule['booked']>();
  for (const row of rows) {
    // `supabase gen types` has no TypeScript for a Postgres range (D15).
    const window = parseWindow(row.scheduled_during);
    const occupied = parseWindow(row.occupies);
    const resourceIds = (row.assignments ?? []).map((assignment) => assignment.resource_id).sort();
    if (!window || !occupied) continue;

    // One work item appears in every lane it takes part in. It is still one work item: the same id
    // and the same window in each, never a copy.
    for (const resourceId of resourceIds) {
      const existing = byResource.get(resourceId) ?? [];
      existing.push({
        workItemId: row.id,
        title: row.title,
        window,
        occupied,
        resourceIds,
        typeId: row.type_id,
        availabilityProblem: problems.get(`${row.id}:${resourceId}`) ?? null,
      });
      byResource.set(resourceId, existing);
    }
  }
  for (const entries of byResource.values()) {
    entries.sort((a, b) => a.window.startsAt.localeCompare(b.window.startsAt));
  }
  return byResource;
}

/** Scheduled work with nobody assigned. Not availability — it takes nothing from anyone — just the truthful answer to "what is on the board with no one on it". */
function unassignedFrom(rows: CommittedRow[]): UnassignedWork[] {
  return rows.flatMap((row) => {
    if ((row.assignments ?? []).length > 0) return [];
    const window = parseWindow(row.scheduled_during);
    return window ? [{ workItemId: row.id, title: row.title, window, typeId: row.type_id }] : [];
  });
}

/** One resource's schedule, from its already-parsed booked entries and the period it is asked about. The other half of the shared logic — free time subtracted from `open`, never from the appointment. */
function resourceSchedulesFor(
  resources: { id: string; name: string }[],
  booked: Map<string, ResourceSchedule['booked']>,
  openByResource: Map<string, Window[]>,
  exceptions: ResourceAvailabilityException[],
  within: Window,
  minimumMinutes?: number,
): ResourceSchedule[] {
  return resources.map((resource) => {
    const entries = booked.get(resource.id) ?? [];
    const open = openByResource.get(resource.id) ?? [];
    return {
      resource: { id: resource.id, name: resource.name },
      booked: entries,
      open,
      exceptions: exceptions.filter(
        (exception) => exception.resourceId === resource.id && overlaps(exception.window, within),
      ),
      free: open.flatMap((window) =>
        freeWindows(
          window,
          // The occupied windows, not the appointments — subtracting the appointment would
          // offer a slot the constraint then refuses.
          entries.map((entry) => entry.occupied),
          { minimumMinutes },
        ),
      ),
    };
  });
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

  const [resources, committed] = await Promise.all([
    db
      .from('resources')
      .select('id, name')
      .eq('organization_id', input.organizationId)
      .order('name', { ascending: true }),
    db
      // `occupies` is what the resource is unavailable for (appointment plus buffer);
      // `scheduled_during` is what the customer was told.
      .from('work_items')
      .select(COMMITTED_SELECT)
      .eq('organization_id', input.organizationId)
      // The constraint's partial predicate, written as a query: a releasing status takes the work
      // off every resource it is on.
      .eq('status_releases_resource', false)
      .overlaps('occupies', range),
  ]);

  if (resources.error) {
    throw new DomainError(resources.error.message, 'availability.resources_failed');
  }
  if (committed.error) {
    throw new DomainError(committed.error.message, 'availability.committed_failed');
  }

  const resourceRows = resources.data ?? [];
  const resourceIds = resourceRows.map((resource) => resource.id);

  // When each resource is open, from the one reader — or the whole range for everyone if the caller
  // gave no date and zone, same as an empty hours set. Not computed per resource here.
  const [openByResource, exceptions, conflicts] = input.on
    ? await Promise.all([
        listResourceOpenWindows(db, { organizationId: input.organizationId, within: input.within, resourceIds }),
        listResourceAvailabilityExceptions(db, { organizationId: input.organizationId, within: input.within }),
        listAvailabilityConflicts(db, { organizationId: input.organizationId, within: input.within }),
      ])
    : [new Map(resourceIds.map((id) => [id, [input.within]])), [], []];

  const booked = groupBookedByResource((committed.data ?? []) as unknown as CommittedRow[], conflicts);
  return resourceSchedulesFor(
    resourceRows,
    booked,
    openByResource,
    exceptions,
    input.within,
    input.minimumMinutes,
  );
}

/** One tenant calendar day's schedule, as `listScheduleDays` returns it — one entry per requested date. */
export type ScheduleDay = {
  date: string;
  /** The day's own absolute bounds (`zonedDayRange`). */
  within: Window;
  /** This day's open periods — the business's own claim, or the whole day if it has made none (I6, advisory). Background context for a caller that draws a timeline; never the source of a second calculation. */
  open: Window[];
  resources: ResourceSchedule[];
  /** Work scheduled this day with nobody on it. Empty is the ordinary answer. */
  unassigned: UnassignedWork[];
};

/**
 * The same availability calculation, generalized to several tenant calendar days at once — what
 * a Week view needs without running `listSchedule`'s full query once per day. Resources, hours
 * and committed work are each read once, over the combined span of the requested dates; each
 * day's own open periods and each resource's booked/free split reuse the exact functions
 * `listSchedule` does (`groupBookedByResource`, `resourceSchedulesFor`, `openWindows`,
 * `freeWindows`) — there is no second availability algorithm here, only a second caller of the
 * first one.
 */
export async function listScheduleDays(
  db: Db,
  input: {
    organizationId: string;
    /** Tenant calendar dates (`YYYY-MM-DD`); need not be contiguous, though Day and Week both ask for contiguous ranges. */
    dates: string[];
    timeZone: string;
    minimumMinutes?: number;
  },
): Promise<ScheduleDay[]> {
  if (input.dates.length === 0) return [];

  const dayWindows = input.dates.map((date) => ({
    date,
    within: zonedDayRange(date, input.timeZone),
  }));
  const sorted = [...dayWindows].sort((a, b) => a.within.startsAt.localeCompare(b.within.startsAt));
  const combined: Window = {
    startsAt: sorted[0].within.startsAt,
    endsAt: sorted[sorted.length - 1].within.endsAt,
  };
  const range = `[${combined.startsAt},${combined.endsAt})`;

  const [resources, committed, hours] = await Promise.all([
    db
      .from('resources')
      .select('id, name')
      .eq('organization_id', input.organizationId)
      .order('name', { ascending: true }),
    db
      .from('work_items')
      .select(COMMITTED_SELECT)
      .eq('organization_id', input.organizationId)
      .eq('status_releases_resource', false)
      .overlaps('occupies', range),
    listOperatingHours(db, { organizationId: input.organizationId }),
  ]);

  if (resources.error) {
    throw new DomainError(resources.error.message, 'availability.resources_failed');
  }
  if (committed.error) {
    throw new DomainError(committed.error.message, 'availability.committed_failed');
  }

  const resourceRows = resources.data ?? [];
  const committedRows = (committed.data ?? []) as unknown as CommittedRow[];
  const [openAcrossRange, exceptionsAcrossRange, conflicts] = await Promise.all([
    listResourceOpenWindows(db, {
      organizationId: input.organizationId,
      within: combined,
      resourceIds: resourceRows.map((resource) => resource.id),
    }),
    listResourceAvailabilityExceptions(db, { organizationId: input.organizationId, within: combined }),
    listAvailabilityConflicts(db, { organizationId: input.organizationId, within: combined }),
  ]);
  const bookedAcrossRange = groupBookedByResource(committedRows, conflicts);
  const unassignedAcrossRange = unassignedFrom(committedRows);

  return dayWindows.map(({ date, within }) => {
    // The combined-range query already scoped the SQL; this scopes each day within it, on the
    // same `occupied` field the exclusion constraint itself cares about — a booking that
    // straddles midnight legitimately appears on both days it occupies.
    const bookedForDay = new Map<string, ResourceSchedule['booked']>();
    for (const [resourceId, entries] of bookedAcrossRange) {
      const inDay = entries.filter((entry) => overlaps(entry.occupied, within));
      if (inDay.length > 0) bookedForDay.set(resourceId, inDay);
    }

    const open = openWindows(date, input.timeZone, hours, within);
    // Each resource's own open windows, cut to this day: a window that runs past midnight is open on both days it covers.
    const openForDay = new Map(
      [...openAcrossRange].map(([resourceId, windows]) => [
        resourceId,
        windows.flatMap((window) => {
          const clipped = clipWindow(window, within);
          return clipped ? [clipped] : [];
        }),
      ]),
    );
    return {
      date,
      within,
      open,
      resources: resourceSchedulesFor(
        resourceRows,
        bookedForDay,
        openForDay,
        exceptionsAcrossRange,
        within,
        input.minimumMinutes,
      ),
      // By the appointment the customer was told, not the buffered window: nobody's time is held.
      unassigned: unassignedAcrossRange.filter((work) => overlaps(work.window, within)),
    };
  });
}
