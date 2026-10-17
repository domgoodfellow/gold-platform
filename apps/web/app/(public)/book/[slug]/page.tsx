import { EmptyState } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import {
  beginBooking,
  bookableSlots,
  listBookableTypes,
  resolveBookingSlug,
  type Slot,
} from '@/lib/domain/booking/booking';
import { BrandStyle } from '@/features/branding/brand-style';
import { Card } from '@/components/surfaces/card';
import { PublicHeader } from '@/features/public-profile/public-header';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { todayInZone } from '@/lib/domain/scheduling/window';
import {
  addCalendarDays,
  describeBookingPolicyReason,
  getEffectiveBookingPolicy,
  offerableDates,
  type BookingPolicy,
} from '@/lib/domain/booking/policy';
import { ButtonLink } from '@/components/controls/button';
import { bookingIntake } from '@/lib/domain/booking/intake';
import { BookingForm } from './booking-form';

export const dynamic = 'force-dynamic';

/**
 * The first surface in this application that isn't the admin one — slots come from the same
 * calculation the operator's schedule uses and the price is the catalogue's own row,
 * so this carries no availability or pricing logic of its own. No shell, no areas — a customer's
 * goal is booking with least friction, not "what do I do next". The slug is resolved to an
 * id by a function that answers only for a business with something published; the id it returns,
 * never the URL, is what the binding is made against.
 */
export default async function BookingPage({
  params,
  searchParams,
}: PageProps<'/book/[slug]'>) {
  const { slug } = await params;
  const { on } = await searchParams;
  const db = await getDb();

  // Absent rather than forbidden — no such business, and a business that publishes nothing, are the same fact from out here.
  const organizationId = await resolveBookingSlug(db, slug);
  if (!organizationId) {
    notFound();
  }

  // Anonymous sign-in and the binding — every policy on this surface keys on `app.current_external_tenant()`.
  await beginBooking(db, { organizationId });

  const { data: organization } = await db
    .from('organizations')
    .select('name, timezone, currency')
    .eq('id', organizationId)
    .maybeSingle();

  if (!organization) {
    notFound();
  }

  const [types, profile, brand] = await Promise.all([
    listBookableTypes(db, { organizationId }),
    publicProfile(db, { organizationId, fallbackName: organization.name }),
    getBrand(db, { organizationId }),
  ]);

  const requested = typeof on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null;
  const date = requested ?? todayInZone(organization.timezone);

  const now = new Date();
  const slotsByType = new Map<string, Slot[]>();
  const policyByType = new Map<string, BookingPolicy>();
  const intakeByType = new Map<string, Awaited<ReturnType<typeof bookingIntake>>>();
  for (const type of types) {
    intakeByType.set(type.id, await bookingIntake(db, { typeId: type.id }));
    const policy = await getEffectiveBookingPolicy(db, { organizationId, typeId: type.id });
    if (policy) policyByType.set(type.id, policy);
    slotsByType.set(
      type.id,
      await bookableSlots(db, { organizationId, type, date, timeZone: organization.timezone, now, policy: policy ?? undefined }),
    );
  }

  // The earliest and latest days any of this business's offers could be booked, for the day links.
  // Advisory navigation only: the server decides what is bookable.
  const ranges = [...policyByType.values()].map((policy) => offerableDates({ now, policy, timeZone: organization.timezone }));
  const first = ranges.map((range) => range.first).sort()[0] ?? date;
  const last = ranges.map((range) => range.last).sort().at(-1) ?? date;
  const previous = addCalendarDays(date, -1);
  const next = addCalendarDays(date, 1);

  // Why a day is empty when policy, not the diary, is the reason. Never mentions resources.
  const emptyDayCopy = (policy: BookingPolicy | undefined): string => {
    if (policy) {
      const range = offerableDates({ now, policy, timeZone: organization.timezone });
      if (date > range.last) return describeBookingPolicyReason('outside_booking_horizon', policy);
      if (date < range.first) {
        return describeBookingPolicyReason(
          !policy.allowSameDay && date === todayInZone(organization.timezone, now) ? 'same_day_booking_not_allowed' : 'minimum_notice_not_met',
          policy,
        );
      }
    }
    return 'Nothing free on this day.';
  };

  const day = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeZone: organization.timezone,
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <main data-brand className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <BrandStyle brand={brand} />
      <PublicHeader
        profile={profile}
        logoUrl={brand.logoPath ? logoUrl(db, brand.logoPath) : null}
      />

      {types.length === 0 ? (
        <EmptyState className="mt-8">Nothing is available to book here.</EmptyState>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          <nav aria-label="Choose a day" className="flex items-center justify-between gap-2">
            {date > first ? (
              <ButtonLink tone="secondary" size="small" href={`/book/${slug}?on=${previous}`}>Previous day</ButtonLink>
            ) : <span aria-hidden />}
            <Hint>{day}</Hint>
            {date < last ? (
              <ButtonLink tone="secondary" size="small" href={`/book/${slug}?on=${next}`}>Next day</ButtonLink>
            ) : <span aria-hidden />}
          </nav>
          {types.map((type) => {
            const slots = slotsByType.get(type.id) ?? [];

            return (
              <Card key={type.id} as="section">
                <h2 className="font-medium">{type.name}</h2>
                <Hint>
                  {type.durationMinutes} minutes
                  {type.price
                    ? ` · ${formatMoney(type.price.amountMinor, type.price.currency)}`
                    : ''}
                </Hint>

                {slots.length === 0 ? (
                  <EmptyState weight="subtle" className="mt-3">{emptyDayCopy(policyByType.get(type.id))}</EmptyState>
                ) : (
                  <BookingForm
                    slug={slug}
                    organizationId={organizationId}
                    typeId={type.id}
                    slots={slots}
                    timeZone={organization.timezone}
                    intake={intakeByType.get(type.id) ?? null}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* The advisory-availability rule, said out loud rather than implied — showing these as reservations would be a promise the platform doesn't keep. */}
      <Hint weight="subtle" className="mt-10 text-xs">
        Times shown are in {organization.timezone} and are not held until you book.
      </Hint>
    </main>
  );
}
