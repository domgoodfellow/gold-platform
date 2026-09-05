/**
 * What a customer sees while their own page is being read.
 *
 * The same reasoning as the booking route's, and a longer wait to justify it: this page reads
 * the profile, the brand, the customer's work and their invoices — and then, for each invoice,
 * its lines and its payments. That last part is a read per invoice rather than one read, which
 * `page.tsx` names out loud; a customer with six invoices waits for thirteen round trips.
 *
 * Nothing here speaks for the business, because nothing that would let it has arrived yet.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-xl p-6 sm:p-8">
      <div role="status" aria-live="polite" className="motion-safe:animate-pulse">
        <span className="sr-only">Loading</span>

        <div className="h-8 w-2/3 rounded bg-border" />
        <div className="mt-3 h-4 w-1/2 rounded bg-border" />

        <div className="mt-8 flex flex-col gap-6">
          {[0, 1].map((section) => (
            <div key={section} aria-hidden className="border-t border-border pt-4">
              <div className="h-4 w-32 rounded bg-border" />
              <div className="mt-3 flex flex-col gap-2">
                <div className="h-3 w-full rounded bg-border" />
                <div className="h-3 w-4/5 rounded bg-border" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
