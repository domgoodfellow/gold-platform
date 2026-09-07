/**
 * What a stranger sees while a business's booking page loads. Nothing here speaks in the
 * business's voice — none of its rows have arrived yet — so this draws shapes and one word of
 * application state. `/book/{slug}` resolves the slug, opens a session, and reads the profile,
 * bookable types and a day of availability, the longest wait on this surface.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-xl p-6 sm:p-8">
      <div role="status" aria-live="polite" className="motion-safe:animate-pulse">
        <span className="sr-only">Loading</span>

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
