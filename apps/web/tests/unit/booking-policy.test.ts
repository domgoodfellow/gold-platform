import { describe, expect, it } from 'vitest';
import {
  alignToCadence,
  amountAndUnit,
  evaluateBookingPolicy,
  evaluateCustomerChange,
  minutesFromAmount,
  offerableDates,
  offerableStartBounds,
  type BookingPolicy,
} from '@/lib/domain/booking/policy';
import { feasibleSlots, type FeasibilityData } from '@/lib/domain/scheduling/feasibility';
import { zonedDayRange, type Window } from '@/lib/domain/scheduling/window';

/**
 * Booking policy is not feasibility: these tests pass `now` in and never touch a resource, except
 * the last group, which composes the two layers. Every instant is written in UTC so a reader can do
 * the arithmetic; the zone under test is named in each case.
 */

const TORONTO = 'America/Toronto';
const AMSTERDAM = 'Europe/Amsterdam';

const POLICY: BookingPolicy = {
  minimumNoticeMinutes: 120,
  maximumHorizonDays: 30,
  cadenceMinutes: 15,
  allowSameDay: true,
  customerRescheduleCutoffMinutes: null,
  customerCancellationCutoffMinutes: null,
  cancellationStatusId: 'cancelled',
};

const evaluate = (now: string, startsAt: string, policy: Partial<BookingPolicy> = {}, timeZone = TORONTO) =>
  evaluateBookingPolicy({ now: new Date(now), startsAt, policy: { ...POLICY, ...policy }, timeZone });

describe('minimum notice is elapsed time and inclusive', () => {
  // 2027-04-05 14:00Z is 10:00 in Toronto (EDT, UTC-4).
  const NOW = '2027-04-05T14:00:00Z';

  it('allows an immediate start when notice is zero', () => {
    expect(evaluate(NOW, NOW, { minimumNoticeMinutes: 0 })).toEqual({ allowed: true, reasons: [] });
  });

  it('refuses 105 minutes away with 120 required, and allows exactly 120', () => {
    expect(evaluate(NOW, '2027-04-05T15:45:00Z').reasons).toEqual(['minimum_notice_not_met']);
    expect(evaluate(NOW, '2027-04-05T16:00:00Z')).toEqual({ allowed: true, reasons: [] });
  });

  it('refuses a start in the past even with no notice', () => {
    expect(evaluate(NOW, '2027-04-05T13:45:00Z', { minimumNoticeMinutes: 0 }).reasons).toEqual(['minimum_notice_not_met']);
  });

  it('is elapsed time across a clock change: two hours is two hours of real time', () => {
    // Toronto springs forward 02:00 → 03:00 on 2027-03-14 (07:00Z). 05:30Z is 00:30 EST.
    const now = '2027-03-14T05:30:00Z';
    expect(evaluate(now, '2027-03-14T07:15:00Z').reasons).toEqual(['minimum_notice_not_met']);
    expect(evaluate(now, '2027-03-14T07:30:00Z')).toEqual({ allowed: true, reasons: [] });
  });
});

describe('cadence anchors to the start’s own local midnight', () => {
  const NOW = '2027-04-01T12:00:00Z';

  it('allows the quarter hours and refuses 10:07', () => {
    // 14:00Z is 10:00 in Toronto.
    for (const t of ['14:00', '14:15', '14:30', '14:45']) {
      expect(evaluate(NOW, `2027-04-05T${t}:00Z`, { minimumNoticeMinutes: 0 }).allowed).toBe(true);
    }
    expect(evaluate(NOW, '2027-04-05T14:07:00Z', { minimumNoticeMinutes: 0 }).reasons).toEqual(['invalid_booking_cadence']);
  });

  it('counts from local midnight, not from UTC midnight', () => {
    // A 60-minute cadence in a zone with a half-hour offset starts on the local hour, not the UTC one.
    expect(evaluate(NOW, '2027-04-05T04:30:00Z', { cadenceMinutes: 60, minimumNoticeMinutes: 0 }, 'Asia/Kolkata').allowed).toBe(true);
    expect(evaluate(NOW, '2027-04-05T04:00:00Z', { cadenceMinutes: 60, minimumNoticeMinutes: 0 }, 'Asia/Kolkata').reasons).toEqual(['invalid_booking_cadence']);
  });

  it('rounds up to the next boundary', () => {
    const ten07 = new Date('2027-04-05T14:07:00Z').getTime();
    expect(new Date(alignToCadence(ten07, 15, TORONTO)).toISOString()).toBe('2027-04-05T14:15:00.000Z');
    expect(new Date(alignToCadence(ten07, 30, TORONTO)).toISOString()).toBe('2027-04-05T14:30:00.000Z');
    // Already on a boundary stays put.
    expect(new Date(alignToCadence(new Date('2027-04-05T14:15:00Z').getTime(), 15, TORONTO)).toISOString()).toBe('2027-04-05T14:15:00.000Z');
  });
});

describe('notice, then cadence: the earliest start a visitor is offered', () => {
  it('is 10:45 at 10:07 with 30 minutes’ notice and a 15-minute cadence — not 10:37', () => {
    const day = zonedDayRange('2027-04-05', TORONTO);
    const bounds = offerableStartBounds({
      now: new Date('2027-04-05T14:07:00Z'),
      policy: { ...POLICY, minimumNoticeMinutes: 30, cadenceMinutes: 15 },
      timeZone: TORONTO,
      day,
    });
    expect(new Date(bounds!.from).toISOString()).toBe('2027-04-05T14:45:00.000Z');
  });

  it('is tomorrow when same-day is off, however little notice there is', () => {
    const now = new Date('2027-04-05T13:00:00Z'); // 09:00 Monday in Toronto
    const policy = { ...POLICY, minimumNoticeMinutes: 60, allowSameDay: false };
    const monday = offerableStartBounds({ now, policy, timeZone: TORONTO, day: zonedDayRange('2027-04-05', TORONTO) });
    const tuesday = offerableStartBounds({ now, policy, timeZone: TORONTO, day: zonedDayRange('2027-04-06', TORONTO) });
    expect(monday).toBeNull();
    expect(new Date(tuesday!.from).toISOString()).toBe('2027-04-06T04:00:00.000Z'); // Tuesday 00:00 local
  });

  it('is null for a day outside the horizon or wholly inside the notice, so no resource work is done for it', () => {
    const now = new Date('2027-04-05T14:00:00Z');
    const policy = { ...POLICY, minimumNoticeMinutes: 1440, maximumHorizonDays: 7 };
    expect(offerableStartBounds({ now, policy, timeZone: TORONTO, day: zonedDayRange('2027-04-05', TORONTO) })).toBeNull();
    expect(offerableStartBounds({ now, policy, timeZone: TORONTO, day: zonedDayRange('2027-04-06', TORONTO) })).not.toBeNull();
    expect(offerableStartBounds({ now, policy, timeZone: TORONTO, day: zonedDayRange('2027-04-12', TORONTO) })).not.toBeNull();
    expect(offerableStartBounds({ now, policy, timeZone: TORONTO, day: zonedDayRange('2027-04-13', TORONTO) })).toBeNull();
    expect(offerableDates({ now, policy, timeZone: TORONTO })).toEqual({ first: '2027-04-06', last: '2027-04-12' });
  });
});

describe('same-day is today in the organization’s zone', () => {
  // 2027-04-06 02:00Z is still Monday 22:00 in Toronto and already Tuesday 04:00 in Amsterdam.
  const NOW = '2027-04-06T02:00:00Z';
  const START = '2027-04-06T13:00:00Z'; // Tuesday 09:00 Toronto; Tuesday 15:00 Amsterdam.

  it('allows it for Toronto, where Tuesday has not started', () => {
    expect(evaluate(NOW, START, { allowSameDay: false, minimumNoticeMinutes: 0 }, TORONTO)).toEqual({ allowed: true, reasons: [] });
  });

  it('refuses it for Amsterdam, where it is already Tuesday', () => {
    expect(evaluate(NOW, START, { allowSameDay: false, minimumNoticeMinutes: 0 }, AMSTERDAM).reasons).toEqual(['same_day_booking_not_allowed']);
  });

  it('is not allowed to be decided by the date at UTC', () => {
    // UTC says Tuesday for both; the answers above differ, so neither used it.
    expect(NOW.slice(0, 10)).toBe(START.slice(0, 10));
  });
});

describe('the horizon is calendar days in the organization’s zone', () => {
  const policy = { minimumNoticeMinutes: 0, cadenceMinutes: 15, maximumHorizonDays: 30 };

  it('includes the whole last day and nothing after it', () => {
    const now = '2027-04-05T14:00:00Z'; // Apr 5 local; the last day is May 5.
    expect(evaluate(now, '2027-05-06T03:45:00Z', policy).allowed).toBe(true); // May 5 23:45 EDT
    expect(evaluate(now, '2027-05-06T04:00:00Z', policy).reasons).toEqual(['outside_booking_horizon']); // May 6 00:00 EDT
  });

  it('stays thirty days across spring-forward', () => {
    const now = '2027-03-01T15:00:00Z'; // Mar 1 EST; Mar 14 springs forward; the last day is Mar 31.
    expect(evaluate(now, '2027-04-01T03:45:00Z', policy).allowed).toBe(true); // Mar 31 23:45 EDT
    expect(evaluate(now, '2027-04-01T04:00:00Z', policy).reasons).toEqual(['outside_booking_horizon']); // Apr 1 00:00 EDT
  });

  it('stays thirty days across fall-back', () => {
    const now = '2027-10-20T14:00:00Z'; // Oct 20 EDT; Nov 7 falls back; the last day is Nov 19.
    expect(evaluate(now, '2027-11-20T04:45:00Z', policy).allowed).toBe(true); // Nov 19 23:45 EST
    expect(evaluate(now, '2027-11-20T05:00:00Z', policy).reasons).toEqual(['outside_booking_horizon']); // Nov 20 00:00 EST
  });

  it('counts the same days in another zone', () => {
    const now = '2027-04-05T14:00:00Z'; // Apr 5 in Amsterdam too; the last day is May 5.
    expect(evaluate(now, '2027-05-05T21:45:00Z', policy, AMSTERDAM).allowed).toBe(true); // May 5 23:45 CEST
    expect(evaluate(now, '2027-05-05T22:00:00Z', policy, AMSTERDAM).reasons).toEqual(['outside_booking_horizon']); // May 6 00:00 CEST
  });
});

describe('customer reschedule and cancellation cutoffs', () => {
  const START = '2027-04-06T14:00:00Z';
  const change = (now: string, action: 'reschedule' | 'cancel', patch: Partial<BookingPolicy> = {}, startsAt: string | null = START) =>
    evaluateCustomerChange({
      now: new Date(now),
      action,
      bookingStartsAt: startsAt,
      policy: { ...POLICY, customerRescheduleCutoffMinutes: 720, customerCancellationCutoffMinutes: 360, ...patch },
    });

  it('allows a reschedule 13 hours out, exactly 12 hours out, and refuses at 11h59', () => {
    expect(change('2027-04-06T01:00:00Z', 'reschedule').allowed).toBe(true);
    expect(change('2027-04-06T02:00:00Z', 'reschedule').allowed).toBe(true);
    expect(change('2027-04-06T02:01:00Z', 'reschedule').reasons).toEqual(['reschedule_cutoff_passed']);
  });

  it('applies the same boundaries to cancelling', () => {
    expect(change('2027-04-06T07:00:00Z', 'cancel').allowed).toBe(true);
    expect(change('2027-04-06T08:00:00Z', 'cancel').allowed).toBe(true);
    expect(change('2027-04-06T08:01:00Z', 'cancel').reasons).toEqual(['cancellation_cutoff_passed']);
  });

  it('judges the booking being changed, never the time it would move to', () => {
    // 15 hours before the new time would be fine; 11 hours before the old one is not.
    expect(change('2027-04-06T03:00:00Z', 'reschedule').reasons).toEqual(['reschedule_cutoff_passed']);
  });

  it('refuses once the booking has started, even with a zero cutoff', () => {
    const zero = { customerRescheduleCutoffMinutes: 0, customerCancellationCutoffMinutes: 0 };
    expect(change(START, 'reschedule', zero).reasons).toEqual(['booking_already_started']);
    expect(change('2027-04-06T15:00:00Z', 'cancel', zero).reasons).toEqual(['booking_already_started']);
    expect(change('2027-04-06T13:59:00Z', 'cancel', zero).allowed).toBe(true);
  });

  it('treats a null cutoff as until it starts, and refuses a booking with no time', () => {
    const open = { customerRescheduleCutoffMinutes: null, customerCancellationCutoffMinutes: null };
    expect(change('2027-04-06T13:59:00Z', 'reschedule', open).allowed).toBe(true);
    expect(change('2027-04-06T13:59:00Z', 'cancel', open).allowed).toBe(true);
    expect(change('2027-04-05T00:00:00Z', 'reschedule', open, null).reasons).toEqual(['booking_not_scheduled']);
  });

  it('offers no cancellation until the business has said where one goes', () => {
    expect(change('2027-04-05T00:00:00Z', 'cancel', { cancellationStatusId: null }).reasons).toEqual(['self_service_not_offered']);
    expect(change('2027-04-05T00:00:00Z', 'reschedule', { cancellationStatusId: null }).allowed).toBe(true);
  });
});

describe('policy and feasibility compose, and each is separate', () => {
  const at = (hh: string) => `2027-04-05T${hh}:00.000Z`;
  const win = (from: string, to: string): Window => ({ startsAt: at(from), endsAt: at(to) });
  // Toronto Monday 2027-04-05: 04:00Z is local midnight, so 14:00Z is 10:00.
  const DAY = zonedDayRange('2027-04-05', TORONTO);

  const data = (overrides: Partial<FeasibilityData> = {}): FeasibilityData => ({
    demands: [{ requirementId: 'person', position: 0, quantity: 1, eligible: ['alex'] }],
    ranks: new Map([['alex', 0]]),
    open: new Map([['alex', [win('13:00', '19:00')]]]), // 09:00–15:00 local
    committed: new Map(),
    exceptions: new Map(),
    organizationHours: null,
    ...overrides,
  });

  function offered(policy: BookingPolicy, now: string, durationMinutes: number, facts: FeasibilityData) {
    const bounds = offerableStartBounds({ now: new Date(now), policy, timeZone: TORONTO, day: DAY });
    if (!bounds) return [];
    return feasibleSlots(facts, {
      range: { startsAt: new Date(bounds.from).toISOString(), endsAt: DAY.endsAt },
      durationMinutes,
      stepMinutes: policy.cadenceMinutes,
      align: (instant) => alignToCadence(instant, policy.cadenceMinutes, TORONTO),
      startBefore: bounds.before,
    });
  }
  const local = (iso: string) => new Date(new Date(iso).getTime() - 4 * 3600_000).toISOString().slice(11, 16);

  it('keeps duration and cadence apart: a 90-minute job offered every 30 ends 90 minutes after each start', () => {
    const slots = offered({ ...POLICY, minimumNoticeMinutes: 0, cadenceMinutes: 30 }, '2027-04-05T00:00:00Z', 90, data());
    const tenThirty = slots.find((slot) => local(slot.startsAt) === '10:30');
    expect(local(tenThirty!.endsAt)).toBe('12:00');
    expect(slots.map((slot) => local(slot.startsAt))).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30']);
  });

  it('begins at 11:30 at 09:07 with two hours’ notice and a 30-minute cadence, though 10:30 and 11:00 are free', () => {
    const slots = offered({ ...POLICY, minimumNoticeMinutes: 120, cadenceMinutes: 30 }, '2027-04-05T13:07:00Z', 60, data());
    expect(local(slots[0].startsAt)).toBe('11:30');
  });

  it('drops a policy-valid start that has no resource free, and a free start that policy forbids', () => {
    const policy = { ...POLICY, minimumNoticeMinutes: 0, cadenceMinutes: 60 };
    // Alex is committed 11:00–12:00 local: that start is feasible-less, though policy allows it.
    const busy = data({ committed: new Map([['alex', [win('15:00', '16:00')]]]) });
    expect(offered(policy, '2027-04-05T00:00:00Z', 60, busy).map((slot) => local(slot.startsAt))).not.toContain('11:00');
    // Same facts, a policy that forbids the morning (notice): feasible 09:00 and 10:00 are absent too.
    const late = offered({ ...policy, minimumNoticeMinutes: 240 }, '2027-04-05T13:00:00Z', 60, data());
    expect(late.map((slot) => local(slot.startsAt))).toEqual(['13:00', '14:00']);
  });

  it('offers nothing past the horizon, however free the resources are', () => {
    const policy = { ...POLICY, minimumNoticeMinutes: 0, maximumHorizonDays: 1 };
    const farDay = zonedDayRange('2027-04-20', TORONTO);
    expect(offerableStartBounds({ now: new Date('2027-04-05T14:00:00Z'), policy, timeZone: TORONTO, day: farDay })).toBeNull();
  });
});

describe('the unit helpers an owner’s form uses', () => {
  it('converts what was typed to minutes and back', () => {
    expect(minutesFromAmount('2', 'hours')).toBe(120);
    expect(minutesFromAmount('1', 'days')).toBe(1440);
    expect(minutesFromAmount('45', 'minutes')).toBe(45);
    expect(minutesFromAmount('', 'hours')).toBeNaN();
    expect(amountAndUnit(120)).toEqual({ amount: 2, unit: 'hours' });
    expect(amountAndUnit(2880)).toEqual({ amount: 2, unit: 'days' });
    expect(amountAndUnit(90)).toEqual({ amount: 90, unit: 'minutes' });
  });
});
