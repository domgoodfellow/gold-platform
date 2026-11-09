import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx, FOCUS_RING } from '../class-names';
import { PLATFORM_NAME } from '@/lib/brand';

/**
 * GOLD's own plain chrome: a header and a footer around the platform's not-found page, which
 * belongs to GOLD rather than to a business. The marketing pages and the credential screens wear
 * `MarketingShell` instead.
 *
 * **Never the `(public)` surfaces, and this is the whole reason it is a separate component from
 * `AppShell`.** `/book/{slug}` and `/portal/{token}` belong to a *tenant* — a customer of theirs
 * meets that business's name, that business's brand, and no mention of the platform underneath
 * (the deferred tenant-marketing decision, and `public-profile.test.ts` fails the build over a platform sentence there). Putting a
 * GOLD header on those pages would put our wordmark on somebody else's shop front. `docs/ui-system.md`
 * §1 already says those two surfaces have no navigation at all; this is what must not be given
 * to them.
 *
 * It is also not `AppShell`: there is no information architecture here to render. An operator's
 * sidebar is a list of one business's areas, and a stranger reading the front page is not in a
 * business yet.
 */
export function SiteShell({
  nav,
  action,
  name = PLATFORM_NAME,
  logoUrl = null,
  footerLine = 'One system that runs your business.',
  children,
}: {
  /**
   * A handful of in-page anchors, for a visitor already reading rather than one deciding
   * whether to. Optional, and used by the marketing page alone — the four credential screens
   * have nothing on the page worth jumping to, and a nav that only sometimes does something is
   * worse than no nav (product reality audit, Slice 4). Hidden below `sm` rather than wrapped:
   * a header is not where a phone has room for a second row.
   */
  nav?: ReactNode;
  /** What sits opposite the wordmark — the link the reader most likely wants next. */
  action?: ReactNode;
  name?: string;
  logoUrl?: string | null;
  footerLine?: string;
  children: ReactNode;
}) {
  return (
    // A column at full height so the footer sits at the bottom of a short page rather than
    // half way up it, and below the fold on a long one.
    <div className="flex min-h-dvh w-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 p-4 sm:px-6">
          <Link
            href="/"
            className={cx('rounded shrink-0 text-lg font-semibold tracking-tight', FOCUS_RING)}
          >
            {logoUrl ? (
              // Organization-owned bytes in the public brand bucket; the host is deployment data.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="mr-2 inline-block max-h-8 max-w-24 object-contain" />
            ) : null}
            <span>{name}</span>
          </Link>
          {nav ? <nav className="hidden min-w-0 flex-1 sm:block">{nav}</nav> : null}
          {action}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6 sm:p-8">{children}</main>

      {/*
        **Nothing here that does not exist.** No Privacy, no Terms, no About — a footer of links
        to pages nobody has written is four dead ends, and this application has enough of those
        recorded already. It says who made the thing and what the thing is, both of which are
        true today.
        **Not the platform's own tagline.** "One engine. Many businesses." describes this platform's
        own architecture to whoever builds it — one engine serving many tenant businesses. Read
        by a visitor rather than a maintainer it says the opposite of what is sold: they are one
        business, not a fleet of them, and "many businesses" is GOLD's shape, not theirs.
      */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4 text-sm text-muted sm:px-6">
          <span>{name}</span>
          <span>{footerLine}</span>
        </div>
      </footer>
    </div>
  );
}
