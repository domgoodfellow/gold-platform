'use client';

import { useEffect } from 'react';
import { Button } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';

/**
 * What one business's screen shows when something threw that nothing expected.
 *
 * **This is for the unexpected half only, and the distinction is already built.** A refusal a
 * person can act on — a role that may not price, a slot already taken, a currency this business
 * has not chosen — is a `DomainError` caught by the server action that raised it and rendered
 * beside the control that caused it. Nothing routine reaches here. What does is a bug, a
 * database that went away, or a policy refusing something the screen believed it could do.
 *
 * **It says one sentence and does not repeat the error.** Next forwards a *generic* message for
 * anything thrown in a Server Component precisely so that server detail cannot leak to a
 * browser, so rendering `error.message` would print either that placeholder or, for a client
 * error, a string written for a developer. `digest` is the useful half: it matches this failure
 * to the server log entry, which is what somebody would actually need to be told over the phone.
 *
 * **The shell survives.** An `error.js` boundary does not wrap the layout in its own segment, so
 * the sidebar, the business's name and its brand are all still on screen — this replaces the
 * content column, and every other area of the business is still one click away. That is worth
 * more than a full-page apology: whatever broke, it probably broke on *this* screen.
 */
export default function OrganizationError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  // **`retry`, not `reset`** — Next 16's name for this prop, and the reason `AGENTS.md` says to
  // read the bundled docs rather than work from memory.
  retry: () => void;
}) {
  useEffect(() => {
    // The only place this failure is recorded. `constraints.md` M5 records that nothing in this
    // schema holds a `DomainError` — it is raised, rendered and dropped — and this is the same
    // gap on the client. A reporting service is where this goes when there is one; until then
    // the console is honest about being all there is.
    console.error(error);
  }, [error]);

  return (
    <div className="mt-8 max-w-prose">
      <SectionHeading>This screen did not load</SectionHeading>

      <Hint className="mt-2">
        Something went wrong reading it. Nothing was changed by the attempt, and the rest of this
        business is still reachable from the menu.
      </Hint>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Re-runs the server component for this segment. Worth offering first, because the
            failure this most often covers is a request that did not arrive. */}
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>

        {error.digest ? (
          // Not decoration: this is the string that matches the entry in the server log, and
          // the one thing somebody reporting the problem can usefully quote.
          <Hint weight="subtle" className="font-mono">
            Reference {error.digest}
          </Hint>
        ) : null}
      </div>
    </div>
  );
}
