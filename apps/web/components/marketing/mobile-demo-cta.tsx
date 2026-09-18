import { ButtonLink } from '@/components/controls/button';

/**
 * The small-screen persistent conversion surface. Plain server-rendered markup — no interaction
 * beyond the link itself, so no client component is needed to keep the primary CTA in view on a
 * phone without a second scroll back to the header.
 */
export function MobileDemoCta() {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-border bg-surface/95 p-3 backdrop-blur sm:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <p className="min-w-0 truncate text-xs text-muted">See GOLD on your own business.</p>
      <ButtonLink href="/demo" tone="primary" size="small" className="shrink-0">
        Request a demo
      </ButtonLink>
    </div>
  );
}
