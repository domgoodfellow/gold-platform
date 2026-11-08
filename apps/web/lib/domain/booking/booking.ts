import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import {
  feasibleSlots,
  judgeInterval,
  loadPublicFeasibilityData,
} from '@/lib/domain/scheduling/feasibility';
import { zonedDayRange, type Window } from '@/lib/domain/scheduling/window';
import {
  alignToCadence,
  evaluateBookingPolicy,
  getEffectiveBookingPolicy,
  offerableStartBounds,
  policyReasonFromDatabase,
  describeBookingPolicyReason,
  type BookingPolicy,
} from '@/lib/domain/booking/policy';

/**
 * Booking: what a stranger may see of a business, and what they may commit it to — the first
 * caller of the anonymous-session model's axis. Everything reads under an RLS policy keyed to
 * `app.current_external_tenant()`; nothing here decides visibility. No second notion of
 * availability or price: `bookableSlots` asks the feasibility engine — the same open windows and
 * commitments `listSchedule` reads, then one distinct resource per slot the work needs — and a
 * price is copied from the catalogue by `add_work_item_priced_line` inside `create_booking` (the one-calculation rule,
 * the single availability model, the advisory-availability rule, the preserved-history rule). A visitor sends a time; which resources take part is the server's to work out and
 * never theirs to name.
 */

export type BookableType = {
  id: string;
  /** The tenant's own word for this kind of work. The platform never translates it. */
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
    throw fromDatabaseError(error, 'booking.slug_failed');
  }

  return (data as string | null) ?? null;
}

/**
 * Become an external actor of one business. Anonymous sign-in first produces a
 * genuine `auth.uid()`, then the binding row scopes it to exactly one tenant — calling this
 * twice is harmless since the unique index on `user_id` makes the second insert a no-op. The
 * organization id is one this process resolved from a slug, never one a URL supplied.
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
    throw fromDatabaseError(error, 'booking.begin_failed');
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
    throw fromDatabaseError(error, 'booking.types_failed');
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
 * When this business could do that work, on one of its days, **for a customer**: the starts policy
 * permits (minimum notice, same-day, the horizon, the cadence) for which the feasibility engine then
 * finds a complete set of resources — every required slot filled by a distinct resource that is
 * eligible, open and uncommitted. Policy bounds come first, so a day or a start that policy forbids
 * costs no resource matching, and nothing here is asked per candidate. The same availability
 * calculation the operator sees, advisory only: the re-assertion is `create_booking`'s own
 * transaction. Resource identities never leave this function — a visitor is offered times.
 *
 * Duration and cadence are separate: a 90-minute job offered every 30 minutes ends 90 minutes after
 * each start, never 30.
 */
export async function bookableSlots(
  db: Db,
  input: {
    organizationId: string;
    type: BookableType;
    date: string;
    timeZone: string;
    /** The instant "now" is for notice and same-day. Defaults to the real clock; tests pass their own. */
    now?: Date;
    /** A booking of the visitor's own to leave out of the commitments, for a reschedule. */
    excludeWorkItemId?: string;
    /** Already read by the caller, when it has read it for the same request. */
    policy?: BookingPolicy;
  },
): Promise<Slot[]> {
  const policy = input.policy ?? (await getEffectiveBookingPolicy(db, { organizationId: input.organizationId, typeId: input.type.id }));
  if (!policy) return [];

  const day = zonedDayRange(input.date, input.timeZone);
  const bounds = offerableStartBounds({ now: input.now ?? new Date(), policy, timeZone: input.timeZone, day });
  if (!bounds) return [];

  // Only the part of the day policy lets a visitor start in is read at all.
  const range: Window = { startsAt: new Date(bounds.from).toISOString(), endsAt: day.endsAt };
  const data = await loadPublicFeasibilityData(db, {
    organizationId: input.organizationId,
    typeId: input.type.id,
    range,
    excludeWorkItemId: input.excludeWorkItemId,
  });

  return feasibleSlots(data, {
    range,
    durationMinutes: input.type.durationMinutes,
    stepMinutes: policy.cadenceMinutes,
    align: (instant) => alignToCadence(instant, policy.cadenceMinutes, input.timeZone),
    startBefore: bounds.before,
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
    /** The instant "now" is for policy. Defaults to the real clock; tests pass their own. */
    now?: Date;
    name: string;
    email: string;
    phone: string;
    /**
     * The business's own questions, when the type asks any: the revision the visitor was shown and
     * their answers. The form itself is never named here — it is the type's.
     */
    intake?: { revisionId: string; answers: Record<string, unknown> };
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
  if (typeError) throw fromDatabaseError(typeError, 'booking.failed');
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

  // Policy first, from the same reader the page used. The database asserts it again inside
  // `create_booking`; this only spares a resource read for a time that could never be booked, and
  // gives the visitor the reason in words.
  const [policy, organization] = await Promise.all([
    getEffectiveBookingPolicy(db, { organizationId: input.organizationId, typeId: input.typeId }),
    db.from('organizations').select('timezone').eq('id', input.organizationId).maybeSingle(),
  ]);
  if (!policy || !organization.data) {
    throw new DomainError('This business is not taking that booking.', 'booking.forbidden');
  }
  const evaluation = evaluateBookingPolicy({
    now: input.now ?? new Date(),
    startsAt,
    policy,
    timeZone: organization.data.timezone,
  });
  if (!evaluation.allowed) {
    throw new DomainError(describeBookingPolicyReason(evaluation.reasons[0], policy), 'booking.policy_refused');
  }

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
      p_intake_revision_id: input.intake?.revisionId,
      p_intake_answers: input.intake ? (input.intake.answers as never) : undefined,
    });
    data = result.data;
    error = result.error;
    if (!error) break;
    // Lost a race for a resource, or one stopped working: look again. Anything else is final.
    if (error.code !== '23P01' && error.code !== 'GD013') break;
  }

  if (error) {
    // The commit's own reassertion of policy (a slot offered earlier, or a direct call): the message
    // is one word of the closed vocabulary.
    if (error.code === 'GD017') {
      const reason = policyReasonFromDatabase(error.message);
      throw new DomainError(
        reason ? describeBookingPolicyReason(reason, policy) : 'That time cannot be booked. Please choose another.',
        'booking.policy_refused',
      );
    }
    // the advisory-availability rule, arriving as a sentence — the slot was free when rendered and is not now, and nothing could have prevented that.
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
    // The questions changed while the visitor was answering (a new revision, or the business started
    // or stopped asking). Nothing was booked and no answer was kept; the page reloads.
    if (error.code === 'GD002') {
      throw new DomainError(
        'This booking was just updated. Please reload the page and book again.',
        'booking.intake_stale',
      );
    }
    // An answer the published revision refuses. The browser and the action check first; this is the
    // database's own refusal, and it too leaves no booking behind.
    if (error.code === '23514') {
      throw fromDatabaseError(error, 'booking.intake_invalid');
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
    throw fromDatabaseError(error, 'booking.failed');
  }

  return data as string;
}
