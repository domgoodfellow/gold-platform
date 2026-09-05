/**
 * What a stranger sees while a business's booking page is being read.
 *
 * **Nothing here is in the business's voice, because at this moment the platform does not know
 * whose page this is.** The name, the logo, the tagline and what is bookable are all rows that
 * have not arrived yet — so this draws shapes and says one word about the system, which is the
 * carve-out `constraints.md` makes: "Loading", "No results" and aria labels stay in code, and
 * nothing else does.
 *
 * It earns its place on this route in particular: `/book/{slug}` resolves the slug, opens an
 * anonymous session, binds it, and then reads the profile, the bookable types and a day of
 * availability. That is the longest wait any surface here has, in front of the reader least
 * likely to give it the benefit of the doubt.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-xl p-6 sm:p-8">
      <div role="status" aria-live="polite" className="motion-safe:animate-pulse">
        <span className="sr-only">Loading</span>

        {/* Roughly where the business's own name and line will land. Two bars, not a mock of
            a header: a business that has configured nothing renders its name and stops, so a
            detailed silhouette would be a promise about a page that may be one line long. */}
        <div className="h-8 w-2/3 rounded bg-border" />
        <div className="mt-3 h-4 w-1/2 rounded bg-border" />

        <div className="mt-8 flex flex-col gap-4">
          {[0, 1].map((row) => (
            <div key={row} aria-hidden className="rounded border border-border p-4">
              <div className="h-4 w-1/3 rounded bg-border" />
              <div className="mt-3 flex flex-wrap gap-2">
                {[0, 1, 2, 3].map((slot) => (
                  <div key={slot} className="h-7 w-20 rounded bg-border" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
