/**
 * What the content column shows while a screen is being read from the database.
 *
 * **The shell stays.** `error.js` and `loading.js` sit *inside* the layout above them, so the
 * sidebar, the business's name, its brand and the area heading are all already on screen and
 * only `{children}` is replaced. That is the whole reason this is worth having: an operator
 * moving between Work and Customers sees the navigation stay put and one column change, rather
 * than a blank page and a spinner.
 *
 * **Every page here is `force-dynamic`, which is what makes this reachable rather than
 * theoretical.** Each one awaits several reads under RLS before it can render anything, and
 * until this file existed the browser showed the *previous* screen for the whole of that wait
 * with no sign that anything was happening.
 *
 * **It draws bars, not a copy of the screen it is standing in for.** A skeleton shaped like a
 * specific page is a promise about what is coming, and the pages here are shaped by what each
 * tenant configured — a business with three custom fields and one with none do not share a
 * silhouette. Bars say *something is loading, roughly this much of it*, which is all the
 * platform actually knows.
 */
export default function Loading() {
  return (
    // `role="status"` with a live region, because for anybody not looking at the screen the
    // pulse is nothing at all. The label is the one word this file says out loud, and it
    // describes application state — which is the half of ui-spec §8 that stays in code.
    <div role="status" aria-live="polite" className="motion-safe:animate-pulse">
      <span className="sr-only">Loading</span>

      <div className="h-6 w-48 rounded bg-border" />
      <div className="mt-6 flex flex-col gap-3">
        {/* Three rows, because most screens here are a list and three is enough to read as
            one. `aria-hidden` on the shapes so the live region announces once rather than
            once per bar. */}
        {[0, 1, 2].map((row) => (
          <div key={row} aria-hidden className="rounded border border-border p-4">
            <div className="h-4 w-1/3 rounded bg-border" />
            <div className="mt-3 h-3 w-2/3 rounded bg-border" />
          </div>
        ))}
      </div>
    </div>
  );
}
