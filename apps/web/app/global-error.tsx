'use client';

import { useEffect } from 'react';
import { SIGN_IN_UNREACHABLE } from '@/lib/domain/errors';

/**
 * The last boundary: something threw in the root layout itself.
 *
 * **This file replaces the whole document, which is why none of this application's own styling
 * is used here.** Next's docs are explicit that `global-error` renders its own `<html>` and
 * `<body>` and does **not** include global styles — so `globals.css` never loads, no colour role
 * resolves, and every class name in `components/` would do nothing. Reaching for `Button` or
 * `Hint` here would produce unstyled markup that looks like a broken page on top of a broken
 * page.
 *
 * So the styles are inline and deliberately plain, and the colours follow the reader's own
 * system setting through `color-scheme` rather than through this platform's tokens. A tenant's
 * brand is emphatically not applied: at this point the code that knows which business is on
 * screen is the code that just failed.
 *
 * **It should be unreachable.** The root layout reads nothing and decides nothing — it sets two
 * fonts and renders `{children}` — so anything that throws in it is a build or runtime fault
 * rather than a data problem. Every failure with a business in hand is caught one boundary down
 * by `organizations/[organizationId]/error.tsx`, which can afford to keep the shell.
 *
 * One expected visitor: a sign-in check that could not complete (`requireActor`) in a business's
 * layout or on a page outside any business, neither of which has a boundary of its own above it.
 * Its digest is fixed, so it gets its own sentence and shows no reference.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const signInUnreachable = error.digest === SIGN_IN_UNREACHABLE;

  return (
    <html lang="en">
      <body
        style={{
          colorScheme: 'light dark',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <main style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
            GildOps did not load
          </h1>
          <p style={{ marginTop: '0.5rem', opacity: 0.7 }}>
            {signInUnreachable
              ? "We couldn't confirm you're signed in. Try again in a moment."
              : 'Something went wrong before any of your businesses could be read. Nothing was changed.'}
          </p>

          <p style={{ marginTop: '1.5rem' }}>
            <button
              type="button"
              onClick={() => retry()}
              style={{
                font: 'inherit',
                padding: '0.5rem 1rem',
                borderRadius: '0.25rem',
                border: '1px solid currentColor',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </p>

          {error.digest && !signInUnreachable ? (
            <p style={{ marginTop: '1rem', opacity: 0.6, fontFamily: 'ui-monospace, monospace' }}>
              Reference {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
