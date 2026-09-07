/**
 * Shown inside the layout while a page's own data loads — the sidebar and brand stay on screen
 * and only the content column changes. Draws bars, not a copy of the page, since each tenant's
 * screen is shaped differently by what they've configured.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="motion-safe:animate-pulse">
      <span className="sr-only">Loading</span>

      <div className="h-6 w-48 rounded bg-border" />
      <div className="mt-6 flex flex-col gap-3">
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
