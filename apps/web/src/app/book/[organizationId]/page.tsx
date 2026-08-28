import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import {
  beginBooking,
  bookableSlots,
  listBookableTypes,
  type Slot,
} from '@/lib/domain/booking/booking';
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
 * Nothing on this page is a claim the platform makes about the business. Every word a visitor
 * reads that is not chrome — the kind of work, what it costs — is a row that business wrote.
 */
export default async function BookingPage({
  params,
  searchParams,
}: PageProps<'/book/[organizationId]'>) {
  const { organizationId } = await params;
  const { on } = await searchParams;
  const db = await getDb();

  // Anonymous sign-in and the binding, before anything is read: every policy on this surface
  // keys on `app.current_external_tenant()`, so a visitor with no binding sees a business that
  // appears not to exist rather than an error.
  await beginBooking(db, { organizationId });

  const { data: organization } = await db
    .from('organizations')
    .select('name, timezone, currency')
    .eq('id', organizationId)
    .maybeSingle();

  // Absent rather than forbidden. From out here, a business that takes no bookings and a
  // business that does not exist are the same thing, and saying which would be a disclosure.
  if (!organization) {
    notFound();
  }

  const types = await listBookableTypes(db, { organizationId });

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
      <h1 className="text-2xl font-semibold">{organization.name}</h1>
      <p className="mt-1 text-sm opacity-70">Book a time · {day}</p>

      {types.length === 0 ? (
        <p className="mt-8 text-sm opacity-70">
          This business is not taking bookings online at the moment.
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-8">
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
