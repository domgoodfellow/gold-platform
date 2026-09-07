import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { freeWindows } from '@/lib/domain/scheduling/availability';
import { listOperatingHours, openWindows } from '@/lib/domain/scheduling/operating-hours';
import { parseWindow, zonedDayRange, type Window } from '@/lib/domain/scheduling/window';

/**
 * Booking: what a stranger may see of a business, and what they may commit it to — the first
 * caller of D22's axis. Everything reads under an RLS policy keyed to
 * `app.current_external_tenant()`; nothing here decides visibility. No second notion of
 * availability or price: `bookableSlots` uses the same pure functions `listSchedule` uses, and a
 * price is copied from the catalogue by `add_work_item_priced_line` inside `create_booking` (I4,
 * I5, I6, I8).
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
  /** An id, never a name — a resource can be a person (D19), and who's free isn't a fact this page publishes. Travels back with the booking so the commit names the same resource the offer was computed against. */
  resourceId: string;
};

/**
 * Which business a public slug names, or null. `app.booking_organization` is privileged and
 * breaks the circle a visitor with no binding is otherwise stuck in — it answers only for a
 * business that has published something bookable. Null covers "no such slug" and "publishes
 * nothing" indistinguishably; the page turns both into a 404.
 */
export async function resolveBookingSlug(db: Db, slug: string): Promise<string | null> {
  const { data, error } = await db.rpc('booking_organization', { p_slug: slug });

  if (error) {
    throw new DomainError(error.message, 'booking.slug_failed');
  }

  return (data as string | null) ?? null;
}

/**
 * Become an external actor of one business. Anonymous sign-in first (D22, I11, D17) produces a
 * genuine `auth.uid()`, then the binding row scopes it to exactly one tenant — calling this
 * twice is harmless since the unique index on `user_id` makes the second insert a no-op. The
 * organization id is one this process resolved from a slug, never one a URL supplied (D17).
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

  // 23505 is this visitor already having a binding — the ordinary case on a reload.
  if (error && error.code !== '23505') {
    throw new DomainError(error.message, 'booking.begin_failed');
  }
}

/** No `bookable` column — a type is published when the business has said which status a booking arrives in and how long one takes, and those two columns are the whole answer. */
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
 * When this business could do that work, on one of its days — the same availability calculation
 * the operator sees (I5), just reading `resource_commitments` (what's occupied, published) in
 * place of the work items themselves. Advisory only (I6): the re-assertion is the exclusion
 * constraint refusing the insert inside `create_booking`.
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

  // No published hours is treated as open, same as the operator's schedule.
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
    // A view has no NOT NULL to read, so `supabase gen types` marks every column nullable (D15).
    const resourceId = resource.id;
    if (!resourceId) continue;

    const free = open.flatMap((window) =>
      freeWindows(window, busyByResource.get(resourceId) ?? [], {
        minimumMinutes: input.type.durationMinutes,
      }),
    );

    // Whole slots from the start of each free window — not a grid on the hour, since the platform has no opinion about when an appointment ought to start.
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

  // One offer per instant — two vans free at nine is one slot to a customer booking a time, not a vehicle.
  const seen = new Set<string>();
  return slots
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .filter((slot) => {
      if (seen.has(slot.startsAt)) return false;
      seen.add(slot.startsAt);
      return true;
    });
}

/** The duration is never an argument — `create_booking` reads it from the type the business published, same shape as `addPricedLine` choosing what and how many but never how much. */
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
    // I6, arriving as a sentence — the slot was free when rendered and is not now, and nothing could have prevented that.
    if (error.code === '23P01') {
      throw new DomainError(
        'Somebody took that time while you were filling this in. Please choose another.',
        'booking.slot_taken',
      );
    }
    // A distinct SQLSTATE from 23505, which is also what a duplicate email raises and means the opposite thing.
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
