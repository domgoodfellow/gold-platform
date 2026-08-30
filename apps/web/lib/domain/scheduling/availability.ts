import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  listOperatingHours,
  openWindows,
  type OperatingHours,
} from '@/lib/domain/scheduling/operating-hours';
import { parseWindow, type Window } from '@/lib/domain/scheduling/window';

/**
 * **The** availability calculation. I5 says there is exactly one, and this is it.
 *
 * I5 is not a statement about tidiness. Two availability calculations are two answers to
 * "can you come on Tuesday", and the one the customer was shown is never the one the
 * dispatcher acts on. Anything that wants to know what is free calls `freeWindows` or
 * `listSchedule`; nothing recomputes.
 *
 * **I6 is the reason this function is allowed to be advisory.** "Availability shown to a
 * client is advisory; it is re-asserted server-side before work is committed." Every answer
 * here is a snapshot that the world may already have invalidated — a second dispatcher, an
 * hour later, the same free slot — and no amount of checking first can close that gap. The
 * re-assertion is `work_items_resource_not_double_booked` refusing the commit, in the same
 * transaction that would have written it. That is why `scheduleWorkItem` deliberately does
 * *not* call this function: a check here before an insert there would be a race with a
 * comforting shape.
 *
 * **Operating hours are subtracted first, and they are entirely the tenant's.** Nothing in
 * this file or in `operating-hours.ts` knows what a working week is: there is no
 * Monday-to-Friday, no weekend, and no default set, because a hardcoded working day is
 * exactly what `constraints.md` forbids. A business that has configured no hours is treated
 * as always open — that is what "it has said nothing" means, and inventing a closing time for
 * it would be the forbidden thing with extra steps.
 */

/** A resource's day: what it is committed to, and what is left. */
export type ResourceSchedule = {
  resource: { id: string; name: string };
  booked: {
    workItemId: string;
    title: string;
    /** The appointment — what the customer was told, and the only one ever rendered. */
    window: Window;
    /**
     * What the resource is actually unavailable for: the appointment plus the tenant's
     * buffer. This is what `free` is computed against and what the exclusion constraint
     * compares, which is the only reason I5 and I7 still agree once a buffer exists.
     */
    occupied: Window;
  }[];
  free: Window[];
};

const MINUTE = 60_000;

function lengthMs(window: Window): number {
  return new Date(window.endsAt).getTime() - new Date(window.startsAt).getTime();
}

/**
 * The gaps left in `within` once every window in `busy` is removed.
 *
 * Pure, and separately tested, because this is the part with the arithmetic in it. Windows
 * are half-open throughout: back-to-back work leaves no gap, and a gap that ends where the
 * next job starts is genuinely free.
 */
export function freeWindows(
  within: Window,
  busy: Window[],
  options: { minimumMinutes?: number } = {},
): Window[] {
  const minimum = (options.minimumMinutes ?? 0) * MINUTE;

  // Sorted and merged first, so overlapping or touching commitments do not produce negative
  // or zero-length gaps. Within one tenant the exclusion constraint means committed windows
  // on one resource never overlap — but this function is also given windows across resources
  // by callers that ask "when is *anyone* free", and it must not depend on that guarantee.
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

/**
 * Every resource's committed work and free time across a window.
 *
 * Two reads, both under RLS: the resources this tenant has, and the work already committed
 * inside the range. The `organization_id` filters are optimisations — the boundary is RLS,
 * as everywhere.
 */
export async function listSchedule(
  db: Db,
  input: {
    organizationId: string;
    within: Window;
    minimumMinutes?: number;
    /**
     * The tenant's calendar date and zone. Given together or not at all: an hours rule is a
     * recurring local reading, so it cannot be resolved to instants without both. Omitted,
     * the whole `within` range is treated as open — which is also what an empty hours set
     * means, so the two absences agree.
     */
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
      // `occupies` is what the resource is unavailable for -- the appointment plus this
      // business's buffer -- and `scheduled_during` is what the customer was told. Both are
      // read because they answer different questions on this screen.
      .from('work_items')
      .select('id, title, resource_id, scheduled_during, occupies')
      .eq('organization_id', input.organizationId)
      .not('resource_id', 'is', null)
      // The three filters here are the exclusion constraint's partial predicate, written as a
      // query. That correspondence is not decoration: what keeps I5 honest is that this
      // calculation and the constraint agree in both directions, so a clause added to one
      // without the other turns a free window into an unbookable one — or worse, the reverse.
      // `status_releases_resource` is the tenant's own answer about their own status, mirrored
      // onto the row because a constraint predicate must be immutable.
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

  // The business's open periods, or the whole range if it has not said. Computed once rather
  // than per resource: hours are the organization's, and a per-resource rota is a different
  // thing that nothing asks for yet.
  const open = input.on
    ? openWindows(input.on.date, input.on.timeZone, hours, input.within)
    : [input.within];

  const byResource = new Map<string, ResourceSchedule['booked']>();
  for (const row of committed.data ?? []) {
    // D15's boundary: `supabase gen types` has no TypeScript for a Postgres range.
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
      // Still one calculation (I5): the open periods are what it is asked about, and
      // committed work is what it subtracts. Adding hours changed the range, not the answer.
      free: open.flatMap((window) =>
        freeWindows(
          window,
          // The occupied windows, not the appointments. Subtracting the appointment would
          // offer a slot the constraint then refuses, which is exactly the disagreement I5
          // exists to prevent.
          booked.map((entry) => entry.occupied),
          { minimumMinutes: input.minimumMinutes },
        ),
      ),
    };
  });
}
