import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { todayInZone, zonedDayRange, type Window } from '@/lib/domain/scheduling/window';

/**
 * Booking policy: when a *customer* may book, and until when they may change their mind.
 *
 * **Policy is not feasibility.** Whether the resources a kind of work needs can do it at an interval
 * is `lib/domain/scheduling/feasibility.ts`; whether a customer is permitted to book that interval
 * is here. This file knows nothing of resources, and feasibility knows nothing of notice. Staff
 * scheduling is bound by feasibility and capability and never by any of this.
 *
 * Two semantics, deliberately different. **Minimum notice is elapsed time** — an instant, `now +
 * notice`, so a clock change cannot alter it. **The horizon and same-day are calendar facts** in the
 * organization's own zone: the horizon is today's local date plus N days, inclusive of that whole
 * day. **Cadence** anchors to the local midnight of the start's own day: a 30-minute cadence is :00
 * and :30 of the local clock whenever the visitor looked, never :07 and :37.
 *
 * The database reasserts every one of these at the commit (`app.booking_policy_refusal`,
 * `app.booking_change_refusal`); this module is the same rules for filtering what is offered, so a
 * visitor is never shown a start the commit would refuse. `booking-policy.test.ts` pins the two
 * together.
 *
 * `now` is always an argument — nothing here reads a clock.
 */

export type BookingPolicy = {
  /** Elapsed minutes between now and a customer-booked start. */
  minimumNoticeMinutes: number;
  /** A customer may book through the end of the organization's local date today + this. */
  maximumHorizonDays: number;
  /** Start times are offered every this many minutes from local midnight. Independent of duration. */
  cadenceMinutes: number;
  allowSameDay: boolean;
  /** Minutes before the booking starts after which a customer may no longer reschedule; null = until it starts. */
  customerRescheduleCutoffMinutes: number | null;
  /** The same for cancelling; null = until it starts. */
  customerCancellationCutoffMinutes: number | null;
  /** The status a customer's cancellation moves a booking to; null = customers cannot cancel. */
  cancellationStatusId: string | null;
};

/** A closed vocabulary: prose belongs to the caller that renders it. */
export type BookingPolicyReason =
  | 'minimum_notice_not_met'
  | 'outside_booking_horizon'
  | 'same_day_booking_not_allowed'
  | 'invalid_booking_cadence';

export type CustomerChangeReason =
  | 'reschedule_cutoff_passed'
  | 'cancellation_cutoff_passed'
  | 'booking_already_started'
  | 'booking_not_scheduled'
  | 'booking_not_active'
  | 'self_service_not_offered';

export type BookingPolicyEvaluation = { allowed: boolean; reasons: BookingPolicyReason[] };

const MINUTE = 60_000;

/** Calendar addition on a `YYYY-MM-DD`: no clock in it, so no clock change can touch it. */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localDate(ms: number, timeZone: string): string {
  return todayInZone(timeZone, new Date(ms));
}

/** Every reason a customer may not book this start, or none. */
export function evaluateBookingPolicy(input: {
  now: Date;
  startsAt: Date | string;
  policy: BookingPolicy;
  timeZone: string;
}): BookingPolicyEvaluation {
  const start = new Date(input.startsAt).getTime();
  const now = input.now.getTime();
  const { policy, timeZone } = input;
  const reasons: BookingPolicyReason[] = [];

  const day = localDate(start, timeZone);
  const midnight = new Date(zonedDayRange(day, timeZone).startsAt).getTime();
  if ((start - midnight) % (policy.cadenceMinutes * MINUTE) !== 0) reasons.push('invalid_booking_cadence');
  // Inclusive: a start exactly `now + notice` is allowed.
  if (start < now + policy.minimumNoticeMinutes * MINUTE) reasons.push('minimum_notice_not_met');
  const today = localDate(now, timeZone);
  if (!policy.allowSameDay && day === today) reasons.push('same_day_booking_not_allowed');
  if (day > addDays(today, policy.maximumHorizonDays)) reasons.push('outside_booking_horizon');

  return { allowed: reasons.length === 0, reasons };
}

/**
 * Whether a customer may still reschedule or cancel a booking of theirs. The cutoff is measured
 * against the booking being changed — never against where a reschedule is going — and a booking that
 * has started cannot be changed by its customer even when the cutoff is zero. A cutoff instant is
 * the *latest* point allowed: exactly at it is still allowed.
 */
export function evaluateCustomerChange(input: {
  now: Date;
  action: 'reschedule' | 'cancel';
  bookingStartsAt: Date | string | null;
  policy: BookingPolicy;
}): { allowed: boolean; reasons: CustomerChangeReason[] } {
  if (input.bookingStartsAt === null) return { allowed: false, reasons: ['booking_not_scheduled'] };
  const start = new Date(input.bookingStartsAt).getTime();
  const now = input.now.getTime();
  if (now >= start) return { allowed: false, reasons: ['booking_already_started'] };

  if (input.action === 'cancel' && input.policy.cancellationStatusId === null) {
    return { allowed: false, reasons: ['self_service_not_offered'] };
  }
  const cutoff =
    input.action === 'reschedule'
      ? input.policy.customerRescheduleCutoffMinutes
      : input.policy.customerCancellationCutoffMinutes;
  if (cutoff !== null && now > start - cutoff * MINUTE) {
    return {
      allowed: false,
      reasons: [input.action === 'reschedule' ? 'reschedule_cutoff_passed' : 'cancellation_cutoff_passed'],
    };
  }
  return { allowed: true, reasons: [] };
}

/** The first cadence boundary at or after an instant, measured from that instant's own local midnight. */
export function alignToCadence(instantMs: number, cadenceMinutes: number, timeZone: string): number {
  const midnight = new Date(zonedDayRange(localDate(instantMs, timeZone), timeZone).startsAt).getTime();
  const step = cadenceMinutes * MINUTE;
  return midnight + Math.ceil((instantMs - midnight) / step) * step;
}

/**
 * The part of one local day in which a customer may *start* a booking: from the later of the day's
 * opening and `now + notice` (and tomorrow's midnight when same-day is off), up to — not including —
 * the end of the horizon's last day. Null when none of the day is inside policy, which is how the
 * caller skips the feasibility work for a day it could never offer. Notice is applied *before*
 * alignment, so 10:07 with 30 minutes' notice and a 15-minute cadence begins at 10:45.
 */
export function offerableStartBounds(input: {
  now: Date;
  policy: BookingPolicy;
  timeZone: string;
  day: Window;
}): { from: number; before: number } | null {
  const { policy, timeZone } = input;
  const dayStart = new Date(input.day.startsAt).getTime();
  const dayEnd = new Date(input.day.endsAt).getTime();
  const today = localDate(input.now.getTime(), timeZone);

  let from = Math.max(dayStart, input.now.getTime() + policy.minimumNoticeMinutes * MINUTE);
  if (!policy.allowSameDay) {
    from = Math.max(from, new Date(zonedDayRange(addDays(today, 1), timeZone).startsAt).getTime());
  }
  from = alignToCadence(from, policy.cadenceMinutes, timeZone);

  const horizonEnd = new Date(zonedDayRange(addDays(today, policy.maximumHorizonDays), timeZone).endsAt).getTime();
  const before = Math.min(dayEnd, horizonEnd);
  return from < before ? { from, before } : null;
}

/** Which of the dates a visitor could look at are inside policy at all, for navigation. */
export function offerableDates(input: { now: Date; policy: BookingPolicy; timeZone: string }): { first: string; last: string } {
  const today = localDate(input.now.getTime(), input.timeZone);
  const earliest = input.now.getTime() + input.policy.minimumNoticeMinutes * MINUTE;
  let first = localDate(earliest, input.timeZone);
  if (!input.policy.allowSameDay && first <= today) first = addDays(today, 1);
  return { first, last: addDays(today, input.policy.maximumHorizonDays) };
}

export { addDays as addCalendarDays };

/**
 * The effective policy for one kind of work, read once per request. Work-Type-owned today: there is no
 * organization-level booking configuration to inherit from, so there is nothing to merge — and one
 * reader means public booking, the configuration screen and anything later (an assistant answering
 * "can this customer reschedule?") cannot derive it differently.
 */
export async function getEffectiveBookingPolicy(
  db: Db,
  input: { organizationId: string; typeId: string },
): Promise<BookingPolicy | null> {
  const { data, error } = await db
    .from('work_item_types')
    .select(
      'booking_status_id, booking_duration_minutes, booking_cadence_minutes, booking_minimum_notice_minutes, booking_horizon_days, booking_allow_same_day, booking_reschedule_cutoff_minutes, booking_cancel_cutoff_minutes, booking_cancellation_status_id',
    )
    .eq('organization_id', input.organizationId)
    .eq('id', input.typeId)
    .maybeSingle();

  if (error) throw new DomainError(error.message, 'booking.policy_read_failed');
  if (!data || data.booking_status_id === null) return null;

  return {
    minimumNoticeMinutes: data.booking_minimum_notice_minutes,
    maximumHorizonDays: data.booking_horizon_days,
    cadenceMinutes: data.booking_cadence_minutes ?? data.booking_duration_minutes ?? 60,
    allowSameDay: data.booking_allow_same_day,
    customerRescheduleCutoffMinutes: data.booking_reschedule_cutoff_minutes,
    customerCancellationCutoffMinutes: data.booking_cancel_cutoff_minutes,
    cancellationStatusId: data.booking_cancellation_status_id,
  };
}

/**
 * Domain-owned wording for what a visitor is told, keyed on the closed vocabulary — the reasons
 * themselves carry no prose. Resource matching is never mentioned: the visitor learns a time is
 * not offered, not why a van is busy.
 */
export function describeBookingPolicyReason(reason: BookingPolicyReason | CustomerChangeReason, policy?: BookingPolicy): string {
  switch (reason) {
    case 'minimum_notice_not_met':
      return policy ? `Bookings need at least ${spell(policy.minimumNoticeMinutes)} notice.` : 'That is too soon to book.';
    case 'outside_booking_horizon':
      return policy ? `Bookings open up to ${policy.maximumHorizonDays} days ahead.` : 'That is too far ahead to book.';
    case 'same_day_booking_not_allowed':
      return 'Same-day bookings are not taken here.';
    case 'invalid_booking_cadence':
      return 'That start time is not offered.';
    case 'reschedule_cutoff_passed':
      return 'It is too close to the appointment to reschedule online. Please contact the business.';
    case 'cancellation_cutoff_passed':
      return 'It is too close to the appointment to cancel online. Please contact the business.';
    case 'booking_already_started':
      return 'This appointment has already started.';
    case 'booking_not_scheduled':
    case 'booking_not_active':
    case 'self_service_not_offered':
      return 'That cannot be changed online. Please contact the business.';
  }
}

/** `120` → "2 hours": whole days, then whole hours, then minutes. */
export function spell(minutes: number): string {
  if (minutes > 0 && minutes % 1440 === 0) return `${minutes / 1440} ${minutes === 1440 ? 'day' : 'days'}`;
  if (minutes > 0 && minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`;
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** The reasons the database raises (GD017), as the same closed vocabulary. Anything else is not one. */
const KNOWN_REASONS: ReadonlySet<string> = new Set<BookingPolicyReason | CustomerChangeReason>([
  'minimum_notice_not_met',
  'outside_booking_horizon',
  'same_day_booking_not_allowed',
  'invalid_booking_cadence',
  'reschedule_cutoff_passed',
  'cancellation_cutoff_passed',
  'booking_already_started',
  'booking_not_scheduled',
  'booking_not_active',
  'self_service_not_offered',
]);

export function policyReasonFromDatabase(message: string): BookingPolicyReason | CustomerChangeReason | null {
  return KNOWN_REASONS.has(message) ? (message as BookingPolicyReason | CustomerChangeReason) : null;
}

export type DurationUnit = 'minutes' | 'hours' | 'days';

/**
 * An owner types "2" and "hours"; the policy stores minutes. NaN, a fraction or a negative comes
 * back as-is so the writer's own bounds refuse it with its sentence — nothing here substitutes a number.
 */
export function minutesFromAmount(amount: string, unit: string): number {
  const per: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 1440 };
  const factor = per[unit as DurationUnit] ?? 1;
  return amount.trim() === '' ? Number.NaN : Number(amount) * factor;
}

/** The largest whole unit that holds a number of minutes exactly, for showing a stored value back. */
export function amountAndUnit(minutes: number): { amount: number; unit: DurationUnit } {
  if (minutes > 0 && minutes % 1440 === 0) return { amount: minutes / 1440, unit: 'days' };
  if (minutes > 0 && minutes % 60 === 0) return { amount: minutes / 60, unit: 'hours' };
  return { amount: minutes, unit: 'minutes' };
}
