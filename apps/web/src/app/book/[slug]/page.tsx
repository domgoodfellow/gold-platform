import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import {
  beginBooking,
  bookableSlots,
  listBookableTypes,
  resolveBookingSlug,
  type Slot,
} from '@/lib/domain/booking/booking';
import { PublicHeader } from '@/features/public-profile/public-header';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { todayInZone } from '@/lib/domain/scheduling/window';
import { BookingForm } from './booking-form';

export const dynamic = 'force-dynamic';

/**
 * The first surface in this application that is not the admin one.
 *
 * D20 held booking back for two milestones and named exactly what it was waiting on: I5, I6
 * and I4, "because a booking page written before them necessarily carries its own notion of
 * availability and its own idea of price — which is precisely the second implementation those
 * invariants exist to forbid, sitting on the surface where being wrong is most expensive."
 * None of that is here. The slots come from the same calculation the operator's schedule uses
 * and the price is the catalogue's own row.
 *
 * **Its navigation model is not the operator's, and D23 says why**: the action an operator's
 * screen is designed around is *what do I do next*, and a customer's is *book this with the
 * least friction*. One model serving both makes both worse. So there is no shell here, no
 * areas, and one thing to do on the page. What is shared is the component vocabulary
 * underneath, never a parallel set.
 *
 * **Nothing on this page is a claim the platform makes about the business.** That is a rule
 * rather than an aspiration: `constraints.md` forbids hardcoding "guarantees, trust points,
 * service assertions, section headings", and carves out only "strings describing *application
 * state*". This page shipped once without that and said "Book a time" in a business's voice.
 *
 * The line, applied concretely: the business's own words at the top (`PublicHeader`, every
 * string a row it wrote), the kinds of work and their prices from its own configuration, and
 * the platform speaking only where it describes what the system is doing — "Nothing free on
 * this day", and the note that a time is not held, which is I6 being honest rather than a claim
 * anybody is making about the business.
 *
 * **The segment is a slug the business chose, not a tenant id**, and that is a correctness
 * point rather than a cosmetic one. D17 says a path segment is routing convenience and must
 * never be an authorization input; under `/organizations/[organizationId]` that holds because
 * RLS re-derives membership whatever the URL claims, and out here there is no membership to
 * re-derive against. So the slug is resolved by a function that answers only for a business
 * which has published something bookable, and the id it returns — never the URL — is what the
 * binding is made against.
 */
export default async function BookingPage({
  params,
  searchParams,
}: PageProps<'/book/[slug]'>) {
  const { slug } = await params;
  const { on } = await searchParams;
  const db = await getDb();

  // Absent rather than forbidden, and the two absences are deliberately indistinguishable: no
  // such business, and a business that publishes nothing, are the same fact from out here.
  const organizationId = await resolveBookingSlug(db, slug);
  if (!organizationId) {
    notFound();
  }

  // Anonymous sign-in and the binding. Every policy on this surface keys on
  // `app.current_external_tenant()`, so nothing below is readable until this has run.
  await beginBooking(db, { organizationId });

  const { data: organization } = await db
    .from('organizations')
    .select('name, timezone, currency')
    .eq('id', organizationId)
    .maybeSingle();

  if (!organization) {
    notFound();
  }

  const [types, profile] = await Promise.all([
    listBookableTypes(db, { organizationId }),
    publicProfile(db, { organizationId, fallbackName: organization.name }),
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
    <main className="mx-auto max-w-xl p-6 sm:p-8">
      <PublicHeader profile={profile} />

      {types.length === 0 ? (
        // Application state, not a claim: there is nothing published to show. A sentence
        // apologising on the business's behalf would be the platform speaking for it.
        <p className="mt-8 text-sm opacity-70">Nothing is available to book here.</p>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
          <p className="text-sm opacity-70">{day}</p>
          {types.map((type) => {
            const slots = slotsByType.get(type.id) ?? [];

            return (
              <section key={type.id}>
                <h2 className="font-medium">{type.name}</h2>
                <p className="text-sm opacity-70">
                  {type.durationMinutes} minutes
                  {type.price
                    ? ` · ${formatMoney(type.price.amountMinor, type.price.currency)}`
                    : ''}
                </p>

                {slots.length === 0 ? (
                  <p className="mt-3 text-sm opacity-60">Nothing free on this day.</p>
                ) : (
                  <BookingForm
                    slug={slug}
                    organizationId={organizationId}
                    typeId={type.id}
                    slots={slots}
                    timeZone={organization.timezone}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* I6, said out loud rather than implied. A page that showed these as reservations would
          be making a promise the platform deliberately does not keep. */}
      <p className="mt-10 text-xs opacity-60">
        Times shown are in {organization.timezone} and are not held until you book.
      </p>
    </main>
  );
}
