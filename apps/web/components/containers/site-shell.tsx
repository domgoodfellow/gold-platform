import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx, FOCUS_RING } from '../class-names';

/**
 * GOLD's own chrome: a header and a footer around the pages that belong to GOLD rather than to a
 * business. The marketing page and the three auth screens, and nothing else.
 *
 * **Never the `(public)` surfaces, and this is the whole reason it is a separate component from
 * `AppShell`.** `/book/{slug}` and `/portal/{token}` belong to a *tenant* — a customer of theirs
 * meets that business's name, that business's brand, and no mention of the platform underneath
 * (D20, and `public-profile.test.ts` fails the build over a platform sentence there). Putting a
 * GOLD header on those pages would put our wordmark on somebody else's shop front. `ui-spec.md`
 * §1 already says those two surfaces have no navigation at all; this is what must not be given
 * to them.
 *
 * It is also not `AppShell`: there is no information architecture here to render. An operator's
 * sidebar is a list of one business's areas, and a stranger reading the front page is not in a
 * business yet.
 */
export function SiteShell({
  action,
  children,
}: {
  /** What sits opposite the wordmark — the link the reader most likely wants next. */
  action?: ReactNode;
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
            className={cx('rounded text-lg font-semibold tracking-tight', FOCUS_RING)}
          >
            GOLD
          </Link>
          {action}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6 sm:p-8">{children}</main>

      {/*
        **Nothing here that does not exist.** No Privacy, no Terms, no About — a footer of links
        to pages nobody has written is four dead ends, and this application has enough of those
        recorded already. It says who made the thing and what the thing is, both of which are
        true today.
      */}
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-4 text-sm text-muted sm:px-6">
          <span>GOLD</span>
          <span>One engine. Many businesses.</span>
        </div>
      </footer>
    </div>
  );
}
