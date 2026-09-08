/**
 * What a customer sees while their portal page loads — this one reads a payment and lines per
 * invoice, so it's a longer wait than most (`page.tsx` names the round-trip count).
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
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
