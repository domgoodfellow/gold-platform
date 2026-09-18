import Link from 'next/link';
import { FOCUS_RING, cx } from '@/components/class-names';
import { MarketingActions, MarketingNav } from './marketing-nav';

/**
 * GOLD's own header: a floating bar that stays with the reader. Never on a `(public)` tenant
 * surface — that would put GOLD's wordmark on somebody else's shop front (D20).
 */
export function MarketingHeader({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 rounded-full border border-border bg-surface/85 py-2 pr-2 pl-5 shadow-sm backdrop-blur-md">
        <Link href="/" className={cx('shrink-0 rounded text-lg font-semibold tracking-tight', FOCUS_RING)}>
          {logoUrl ? (
            // Organization-owned bytes in the public brand bucket; the host is deployment data.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="mr-2 inline-block max-h-7 max-w-24 object-contain" />
          ) : null}
          <span>{name}</span>
        </Link>
        <nav aria-label="Primary" className="hidden min-w-0 flex-1 sm:block">
          <MarketingNav />
        </nav>
        <MarketingActions />
      </div>
    </header>
  );
}
