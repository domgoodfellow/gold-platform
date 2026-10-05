import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  feasibleSlots,
  judgeInterval,
  loadPublicFeasibilityData,
} from '@/lib/domain/scheduling/feasibility';
import { zonedDayRange } from '@/lib/domain/scheduling/window';

/**
 * Booking: what a stranger may see of a business, and what they may commit it to — the first
 * caller of D22's axis. Everything reads under an RLS policy keyed to
 * `app.current_external_tenant()`; nothing here decides visibility. No second notion of
 * availability or price: `bookableSlots` asks the feasibility engine — the same open windows and
 * commitments `listSchedule` reads, then one distinct resource per slot the work needs — and a
 * price is copied from the catalogue by `add_work_item_priced_line` inside `create_booking` (I4,
 * I5, I6, I8). A visitor sends a time; which resources take part is the server's to work out and
 * never theirs to name.
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
 * When this business could do that work, on one of its days: the intervals for which a complete
 * set of resources exists — every required slot filled by a distinct resource that is eligible,
 * open and uncommitted. The same availability calculation the operator sees (I5), read through the
 * published commitments, and advisory only (I6): the re-assertion is `create_booking`'s own
 * transaction. Resource identities never leave this function — a visitor is offered times.
 *
 * Candidate starts step by the duration, as booking always has; duration and step are separate
 * inputs to the engine so a later cadence rule changes one without the other.
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
  const range = zonedDayRange(input.date, input.timeZone);
  const data = await loadPublicFeasibilityData(db, {
    organizationId: input.organizationId,
    typeId: input.type.id,
    range,
  });

  return feasibleSlots(data, {
    range,
    durationMinutes: input.type.durationMinutes,
    stepMinutes: input.type.durationMinutes,
  }).map(({ startsAt, endsAt }) => ({ startsAt, endsAt }));
}

/** How many times a booking re-reads the world and tries again after losing a race. Small and bounded, never a loop. */
const BOOKING_ATTEMPTS = 3;

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

  // The duration is the type's, read here only to know how long to hold the resources for.
  const { data: type, error: typeError } = await db
    .from('work_item_types')
    .select('booking_duration_minutes')
    .eq('organization_id', input.organizationId)
    .eq('id', input.typeId)
    .maybeSingle();
  if (typeError) throw new DomainError(typeError.message, 'booking.failed');
  if (!type?.booking_duration_minutes) {
    throw new DomainError('This business is not taking that booking.', 'booking.forbidden');
  }
  const startsAt = new Date(input.slot.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    throw new DomainError('That time is no longer available. Please choose another.', 'booking.slot_taken');
  }
  const interval = {
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + type.booking_duration_minutes * 60_000).toISOString(),
  };

  let data: string | null = null;
  let error: { code?: string; message: string } | null = null;

  // **The server chooses; the database checks.** The combination is worked out now, from current
  // facts, never taken from the page that offered the slot (a stale or forged identity cannot ride
  // along). `create_booking` then verifies it as a certificate and the assignment triggers and the
  // exclusion constraint decide, in one transaction. If another booking won a resource between the
  // two, one more look may find a different complete set — a bounded retry, each attempt atomic, so
  // two bookings can both succeed on distinct combinations and never on the same resource.
  for (let attempt = 0; attempt < BOOKING_ATTEMPTS; attempt += 1) {
    const facts = await loadPublicFeasibilityData(db, {
      organizationId: input.organizationId,
      typeId: input.typeId,
      range: interval,
    });
    const verdict = judgeInterval(facts, interval);
    if (!verdict.feasible || !verdict.combination) {
      throw new DomainError('That time is no longer available. Please choose another.', 'booking.slot_taken');
    }

    const result = await db.rpc('create_booking', {
      p_organization_id: input.organizationId,
      p_type_id: input.typeId,
      p_allocations: verdict.combination.map((entry) => ({
        requirement_id: entry.requirementId,
        resource_id: entry.resourceId,
      })),
      p_starts_at: interval.startsAt,
      p_name: name,
      p_email: input.email,
      p_phone: input.phone,
    });
    data = result.data;
    error = result.error;
    if (!error) break;
    // Lost a race for a resource, or one stopped working: look again. Anything else is final.
    if (error.code !== '23P01' && error.code !== 'GD013') break;
  }

  if (error) {
    // I6, arriving as a sentence — the slot was free when rendered and is not now, and nothing could have prevented that.
    if (error.code === '23P01' || error.code === 'GD014') {
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
    // `create_booking` reasserts what the page offered: the resource must still be eligible for what
    // this kind of work needs, and a type that needs more than one resource cannot be booked here.
    if (error.code === 'GD012') {
      throw new DomainError(
        'That time is no longer available. Please choose another.',
        'booking.not_eligible',
      );
    }
    // The resource stopped working at that time between the page and the booking: its hours changed
    // or time off was added. Said the same way as a slot somebody took — nothing about who is off.
    if (error.code === 'GD013') {
      throw new DomainError(
        'That time is no longer available. Please choose another.',
        'booking.not_working',
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

  return data as string;
}
