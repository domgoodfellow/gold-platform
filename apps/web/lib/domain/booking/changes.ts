import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { bookableSlots, type BookableType, type Slot } from '@/lib/domain/booking/booking';
import {
  describeBookingPolicyReason,
  evaluateBookingPolicy,
  getEffectiveBookingPolicy,
  policyReasonFromDatabase,
  type BookingPolicyReason,
  type CustomerChangeReason,
} from '@/lib/domain/booking/policy';
import { judgeInterval, loadPublicFeasibilityData } from '@/lib/domain/scheduling/feasibility';
import { parseWindow } from '@/lib/domain/scheduling/window';

/**
 * A customer changing a booking of their own: rescheduling it or cancelling it, inside the limits the
 * business set (`policy.ts`). Authority is the visitor's own session — the booking must be the one
 * their session made, in the business their binding names — and is the database's to check; nothing
 * here takes an organization, a customer or an email from the browser as proof.
 *
 * **Neither is a Work lifecycle of its own.** A cancellation is the business's own board move to the
 * status it named for it, so the resources go back through that status's `releases_resource`, and the
 * work item is never deleted. A reschedule moves the same work item; its window and its assignments
 * change in one transaction or not at all. No fee, refund or message is decided here: later slices
 * read the `work_item.cancelled_by_customer` / `work_item.rescheduled_by_customer` events.
 */

export type BookingChangeOptions = {
  canReschedule: boolean;
  rescheduleRefusal: CustomerChangeReason | null;
  canCancel: boolean;
  cancelRefusal: CustomerChangeReason | null;
};

export async function getBookingChangeOptions(db: Db, input: { workItemId: string }): Promise<BookingChangeOptions | null> {
  const { data, error } = await db.rpc('booking_change_options', { p_work_item_id: input.workItemId });
  if (error) throw new DomainError(error.message, 'booking.change_options_failed');
  return (data as BookingChangeOptions | null) ?? null;
}

function refusal(message: string): DomainError | null {
  const reason = policyReasonFromDatabase(message);
  return reason ? new DomainError(describeBookingPolicyReason(reason), 'booking.change_refused') : null;
}

export async function cancelBooking(db: Db, input: { workItemId: string }): Promise<void> {
  const { error } = await db.rpc('customer_cancel_booking', { p_work_item_id: input.workItemId });
  if (!error) return;
  if (error.code === 'GD017') throw refusal(error.message) ?? new DomainError('That cannot be changed online.', 'booking.change_refused');
  if (error.code === '42501') throw new DomainError('That booking is not yours to change.', 'booking.forbidden');
  throw new DomainError(error.message, 'booking.cancel_failed');
}

/** The times this booking could move to on one day: the public slots, with its own time set aside. */
export async function rescheduleSlots(
  db: Db,
  input: { organizationId: string; workItemId: string; type: BookableType; date: string; timeZone: string; now?: Date },
): Promise<Slot[]> {
  return bookableSlots(db, {
    organizationId: input.organizationId,
    type: input.type,
    date: input.date,
    timeZone: input.timeZone,
    now: input.now,
    excludeWorkItemId: input.workItemId,
  });
}

const ATTEMPTS = 3;

/**
 * Move a booking to another start, keeping its length. The server works out who takes part — the
 * booking's current resources first when they still fit (the same deterministic preference staff
 * rescheduling has) — and the database verifies it, applies it atomically and re-asserts every rule.
 */
export async function rescheduleBooking(
  db: Db,
  input: { organizationId: string; workItemId: string; startsAt: string; now?: Date },
): Promise<void> {
  const start = new Date(input.startsAt);
  const gone = () => new DomainError('That time is no longer available. Please choose another.', 'booking.slot_taken');
  if (Number.isNaN(start.getTime())) throw gone();

  const { data: item, error: itemError } = await db
    .from('work_items')
    .select('type_id, scheduled_during')
    .eq('organization_id', input.organizationId)
    .eq('id', input.workItemId)
    .maybeSingle();
  if (itemError) throw new DomainError(itemError.message, 'booking.reschedule_failed');
  const window = parseWindow(item?.scheduled_during as string | null | undefined);
  if (!item || !window) throw new DomainError('That booking is not yours to change.', 'booking.forbidden');

  const length = new Date(window.endsAt).getTime() - new Date(window.startsAt).getTime();
  const interval = { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + length).toISOString() };

  const [policy, organization] = await Promise.all([
    getEffectiveBookingPolicy(db, { organizationId: input.organizationId, typeId: item.type_id }),
    db.from('organizations').select('timezone').eq('id', input.organizationId).maybeSingle(),
  ]);
  if (!policy || !organization.data) throw new DomainError('That cannot be changed online.', 'booking.change_refused');
  const evaluation = evaluateBookingPolicy({
    now: input.now ?? new Date(),
    startsAt: start,
    policy,
    timeZone: organization.data.timezone,
  });
  if (!evaluation.allowed) {
    throw new DomainError(describeBookingPolicyReason(evaluation.reasons[0] as BookingPolicyReason, policy), 'booking.policy_refused');
  }

  let error: { code?: string; message: string } | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const [facts, own] = await Promise.all([
      loadPublicFeasibilityData(db, {
        organizationId: input.organizationId,
        typeId: item.type_id,
        range: interval,
        excludeWorkItemId: input.workItemId,
      }),
      db.rpc('booking_own_commitments', { p_work_item_id: input.workItemId }),
    ]);
    const current = (own.data ?? []).map((row) => row.resource_id);
    const verdict = judgeInterval(facts, interval, { prefer: current });
    if (!verdict.feasible || !verdict.combination) throw gone();

    const result = await db.rpc('customer_reschedule_booking', {
      p_work_item_id: input.workItemId,
      p_allocations: verdict.combination.map((entry) => ({
        requirement_id: entry.requirementId,
        resource_id: entry.resourceId,
      })),
      p_starts_at: interval.startsAt,
    });
    error = result.error;
    if (!error) return;
    if (error.code !== '23P01' && error.code !== 'GD013') break;
  }

  if (error) {
    if (error.code === 'GD017') throw refusal(error.message) ?? new DomainError('That cannot be changed online.', 'booking.change_refused');
    if (error.code === '23P01' || error.code === 'GD013' || error.code === 'GD012' || error.code === 'GD014') throw gone();
    if (error.code === '42501') throw new DomainError('That booking is not yours to change.', 'booking.forbidden');
    throw new DomainError(error.message, 'booking.reschedule_failed');
  }
}
