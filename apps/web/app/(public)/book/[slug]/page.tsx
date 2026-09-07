import { EmptyState } from '@/components/containers/section';
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
import { Card } from '@/components/containers/card';
import { PublicHeader } from '@/features/public-profile/public-header';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { BookingForm } from './booking-form';

export const dynamic = 'force-dynamic';

/**
 * The first surface in this application that isn't the admin one — slots come from the same
 * calculation the operator's schedule uses (I5) and the price is the catalogue's own row (I4),
 * so this carries no availability or pricing logic of its own. No shell, no areas — a customer's
 * goal is booking with least friction, not "what do I do next" (D23). The slug is resolved to an
 * id by a function that answers only for a business with something published; the id it returns,
 * never the URL, is what the binding is made against (D17).
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

  const slotsByType = new Map<string, Slot[]>();
  for (const type of types) {
    slotsByType.set(
      type.id,
      await bookableSlots(db, { organizationId, type, date, timeZone: organization.timezone }),
    );
  }

  const day = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'full',
    timeZone: organization.timezone,
  }).format(new Date(`${date}T12:00:00Z`));

  return (
    <main data-brand className="mx-auto max-w-xl p-6 sm:p-8">
      <BrandStyle brand={brand} />
      <PublicHeader
        profile={profile}
        logoUrl={brand.logoPath ? logoUrl(db, brand.logoPath) : null}
      />

      {types.length === 0 ? (
        <EmptyState className="mt-8">Nothing is available to book here.</EmptyState>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          <Hint>{day}</Hint>
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
                  <EmptyState weight="subtle" className="mt-3">Nothing free on this day.</EmptyState>
                ) : (
                  <BookingForm
                    slug={slug}
                    organizationId={organizationId}
                    typeId={type.id}
                    slots={slots}
                    timeZone={organization.timezone}
                  />
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* I6, said out loud rather than implied — showing these as reservations would be a promise the platform doesn't keep. */}
      <Hint weight="subtle" className="mt-10 text-xs">
        Times shown are in {organization.timezone} and are not held until you book.
      </Hint>
    </main>
  );
}
