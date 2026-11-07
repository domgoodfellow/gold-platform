'use client';

import { useEffect } from 'react';
import { Button } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/surfaces/section';
import { SIGN_IN_UNREACHABLE } from '@/lib/domain/errors';

/**
 * For the unexpected only — a `DomainError` a person can act on is caught and rendered beside
 * its control; what reaches here is a bug or an outage. `error.message` isn't shown: Next
 * forwards a generic message for anything thrown server-side, so `digest` (matching the server
 * log entry) is the only useful thing to surface. The layout survives — this replaces only the
 * content column. The one error recognised by name is a sign-in check that could not complete
 * (`requireActor`): its digest is fixed, so it is no reference, and it gets its own sentence.
 */
export default function OrganizationError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  /** Next 16's name for `reset` — see AGENTS.md on reading the bundled docs rather than memory. */
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const signInUnreachable = error.digest === SIGN_IN_UNREACHABLE;

  return (
    <div className="mt-8 max-w-prose">
      <SectionHeading>This screen did not load</SectionHeading>

      <Hint className="mt-2">
        {signInUnreachable
          ? "We couldn't confirm you're signed in. Try again in a moment."
          : 'Something went wrong reading it. Nothing was changed by the attempt, and the rest of this business is still reachable from the menu.'}
      </Hint>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>

        {error.digest && !signInUnreachable ? (
          <Hint weight="subtle" className="font-mono">
            Reference {error.digest}
          </Hint>
        ) : null}
      </div>
    </div>
  );
}
