import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { freeWindows } from '@/lib/domain/scheduling/availability';
import { listOperatingHours, openWindows } from '@/lib/domain/scheduling/operating-hours';
import { parseWindow, zonedDayRange, type Window } from '@/lib/domain/scheduling/window';

/**
 * Booking: what a stranger may see of a business, and what they may commit it to.
 *
 * This module is the first caller of D22's axis. Everything it reads is restricted by an RLS
 * policy keyed to `app.current_external_tenant()`, and nothing in this file decides who may
 * see what — the migration does, in policies written as *permit* rather than as "unless
 * refused". If a query here returns nothing, the honest reading is that the business has not
 * published that thing, not that the code forgot a filter.
 *
 * **It carries no second notion of availability and no second notion of price.** D20 blocked
 * booking on I5, I6 and I4 for exactly that reason: a booking page written before them would
 * necessarily have invented its own answers, on the surface where being wrong is most
 * expensive. So `bookableSlots` subtracts commitments from opening hours with the same two
 * pure functions `listSchedule` uses, and a price is copied from the catalogue by
 * `add_work_item_priced_line` inside `create_booking` — the same copy every quote gets (I4, I8).
 */

export type BookableType = {
  id: string;
  /** The tenant's own word for this kind of work. The platform never translates it (D6). */
  name: string;
  durationMinutes: number;
  /** What the business publishes as the price, or null if it does not publish one. */
  price: { amountMinor: number; currency: string; description: string } | null;
};

export type Slot = {
  startsAt: string;
  endsAt: string;
  /**
   * A resource that is free for this slot.
   *
   * An id and never a name: a resource can be a person (D19), and which member of staff is
   * free on Tuesday is not a fact a booking page has any reason to publish. It travels back
   * with the booking so the commit names the same resource the offer was computed against.
   */
  resourceId: string;
};

/**
 * Which business a public slug names, or null.
 *
 * **A visitor arriving with a slug has no binding, and therefore no RLS scope at all** — every
 * policy on this axis keys on `app.current_external_tenant()`, so they cannot read the very row
 * that would tell them which business they are looking at. `app.booking_organization` breaks
 * that circle: privileged, one uuid out, and it answers only for a business that has actually
 * published something bookable, which is what makes the public directory opt-in.
 *
 * Null covers "no such slug" and "that business publishes nothing" indistinguishably, and the
 * page turns both into a 404. From outside, those are the same fact.
 */
export async function resolveBookingSlug(db: Db, slug: string): Promise<string | null> {
  const { data, error } = await db.rpc('booking_organization', { p_slug: slug });

  if (error) {
    throw new DomainError(error.message, 'booking.slug_failed');
  }

  return (data as string | null) ?? null;
}

/**
 * Become an external actor of one business.
 *
 * Anonymous sign-in first — D22 named it as the option costing I11 and D17 the least, because
 * it produces a genuine `auth.uid()` — then the binding row that scopes it to exactly one
 * tenant. Calling this twice for one visitor is harmless: the unique index on `user_id` means
 * the second insert conflicts, and the existing binding is the correct answer anyway.
 *
 * The organization id is one this process resolved from a slug, never one a URL supplied. That
 * distinction is D17's: a path segment is routing convenience and must never be an
 * authorization input, and out here there is no membership to re-derive it against.
 *
 * A member of the business must never end up here. The unique index would let them hold a
 * binding as well as a membership, so the guard is that this signs in *anonymously* — a
 * caller who already has a session keeps it and takes the member path.
 */
export async function beginBooking(db: Db, input: { organizationId: string }): Promise<void> {
  const { data: existing } = await db.auth.getUser();

  if (!existing.user) {
    const { error } = await db.auth.signInAnonymously();
    if (error) {
      throw new DomainError('This booking page is not available right now.', 'booking.no_session');
    }
  }

  const { data: user } = await db.auth.getUser();
  if (!user.user) {
    throw new DomainError('This booking page is not available right now.', 'booking.no_session');
  }

  const { error } = await db
    .from('external_actors')
    .insert({ organization_id: input.organizationId, user_id: user.user.id });

  // 23505 is this visitor already having a binding, which is the ordinary case on a reload.
  // Any other error is real.
  if (error && error.code !== '23505') {
    throw new DomainError(error.message, 'booking.begin_failed');
  }
}

/**
 * What this business takes bookings for.
 *
 * Reads `work_item_types` under the external policy, which already restricts this to published
 * types — there is no `bookable` filter here because there is no `bookable` column: a type is
 * published when the business has said which status a booking arrives in and how long one
 * takes, and those two columns are the whole answer.
 */
export async function listBookableTypes(
  db: Db,
  input: { organizationId: string },
): Promise<BookableType[]> {
  const { data, error } = await db
    .from('work_item_types')
    .select(
      'id, name, booking_duration_minutes, price:price_book_items!work_item_types_booking_price_same_org (name, unit_amount_minor, currency)',
    )
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'booking.types_failed');
  }

  return (data ?? []).flatMap((row) => {
    if (row.booking_duration_minutes === null) return [];
    const price = Array.isArray(row.price) ? row.price[0] : row.price;

    return [
      {
        id: row.id,
        name: row.name,
        durationMinutes: row.booking_duration_minutes,
        price: price
          ? {
              amountMinor: price.unit_amount_minor,
              currency: price.currency,
              description: price.name,
            }
          : null,
      },
    ];
  });
}

/**
 * When this business could do that work, on one of its days.
 *
 * **The same availability calculation the operator sees** — `openWindows` minus the
 * commitments, through `freeWindows` — which is what I5 requires and what D20 said booking was
 * blocked on. What differs is the *read*, not the arithmetic: an outsider sees
 * `resource_commitments`, which publishes when a resource is occupied and nothing else, while
 * an operator reads the work items themselves.
 *
 * **Every answer here is advisory (I6).** Nothing is held, nothing is reserved, and the slot
 * offered may be taken between rendering this page and submitting it. The re-assertion is the
 * exclusion constraint refusing the insert inside `create_booking`, and `bookBooking` turns
 * that refusal into a sentence.
 */
export async function bookableSlots(
  db: Db,
  input: {
    organizationId: string;
    type: BookableType;
    date: string;
    timeZone: string;
  },
): Promise<Slot[]> {
  const within = zonedDayRange(input.date, input.timeZone);
  const range = `[${within.startsAt},${within.endsAt})`;

  const [resources, commitments, hours] = await Promise.all([
    db.from('bookable_resources').select('id').eq('organization_id', input.organizationId),
    db
      .from('resource_commitments')
      .select('resource_id, occupies')
      .eq('organization_id', input.organizationId)
      .overlaps('occupies', range),
    listOperatingHours(db, { organizationId: input.organizationId }),
  ]);

  if (resources.error) throw new DomainError(resources.error.message, 'booking.resources_failed');
  if (commitments.error) {
    throw new DomainError(commitments.error.message, 'booking.commitments_failed');
  }

  // A business that has published no hours is treated as open, exactly as the operator's
  // schedule treats it — the absence of a rule is not a closed door (see `availability.ts`).
  const open = openWindows(input.date, input.timeZone, hours, within);

  const busyByResource = new Map<string, Window[]>();
  for (const row of commitments.data ?? []) {
    const occupied = parseWindow(row.occupies as string | null);
    if (!occupied || !row.resource_id) continue;
    busyByResource.set(row.resource_id, [...(busyByResource.get(row.resource_id) ?? []), occupied]);
  }

  const slots: Slot[] = [];
  const stepMs = input.type.durationMinutes * 60_000;

  for (const resource of resources.data ?? []) {
    // `supabase gen types` marks every view column nullable — a view has no NOT NULL to read
    // — so this narrows what the underlying column already guarantees (D15's boundary again).
    const resourceId = resource.id;
    if (!resourceId) continue;

    const free = open.flatMap((window) =>
      freeWindows(window, busyByResource.get(resourceId) ?? [], {
        minimumMinutes: input.type.durationMinutes,
      }),
    );

    // Whole slots from the start of each free window. Not a grid on the hour: a business
    // whose gaps do not begin on the hour would be offered nothing by one, and the platform
    // has no opinion about when an appointment ought to start.
    for (const window of free) {
      const end = new Date(window.endsAt).getTime();
      for (
        let cursor = new Date(window.startsAt).getTime();
        cursor + stepMs <= end;
        cursor += stepMs
      ) {
        slots.push({
          startsAt: new Date(cursor).toISOString(),
          endsAt: new Date(cursor + stepMs).toISOString(),
          resourceId,
        });
      }
    }
  }

  // One offer per instant. Two vans free at nine is one slot to a customer, who is booking a
  // time rather than a vehicle — and the id that travels is whichever is free.
  const seen = new Set<string>();
  return slots
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .filter((slot) => {
      if (seen.has(slot.startsAt)) return false;
      seen.add(slot.startsAt);
      return true;
    });
}

/**
 * Take the slot.
 *
 * The duration is not an argument and cannot be: `create_booking` reads it from the type the
 * business published, so a caller chooses *what* and *when* but never *how long*. That is the
 * same shape as `addPricedLine`, where a caller chooses what and how many but never how much.
 */
export async function bookSlot(
  db: Db,
  input: {
    organizationId: string;
    typeId: string;
    slot: Slot;
    name: string;
    email: string;
    phone: string;
  },
): Promise<string> {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new DomainError('Please give a name for the booking.', 'booking.name_required');
  }

  if (input.email.trim().length === 0 && input.phone.trim().length === 0) {
    throw new DomainError(
      'Please leave an email address or a phone number, so this business can reach you.',
      'booking.contact_required',
    );
  }

  const { data, error } = await db.rpc('create_booking', {
    p_organization_id: input.organizationId,
    p_type_id: input.typeId,
    p_resource_id: input.slot.resourceId,
    p_starts_at: input.slot.startsAt,
    p_name: name,
    p_email: input.email,
    p_phone: input.phone,
  });

  if (error) {
    // I6, arriving as a sentence. The slot was free when the page was rendered and is not
    // now, and nothing could have prevented that — a check before the insert would have
    // raced identically.
    if (error.code === '23P01') {
      throw new DomainError(
        'Somebody took that time while you were filling this in. Please choose another.',
        'booking.slot_taken',
      );
    }
    // A SQLSTATE of its own, because 23505 is also what a duplicate email raises and the two
    // mean opposite things to the person reading the sentence.
    if (error.code === 'GD001') {
      throw new DomainError(
        'This booking has already been made.',
        'booking.already_booked',
      );
    }
    if (error.code === '42501') {
      throw new DomainError(
        'This business is not taking that booking.',
        'booking.forbidden',
      );
    }
    throw new DomainError(error.message, 'booking.failed');
  }

  return data;
}
