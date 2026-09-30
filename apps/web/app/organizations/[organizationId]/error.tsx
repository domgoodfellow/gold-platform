'use client';

import { useEffect } from 'react';
import { Button } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/surfaces/section';

/**
 * For the unexpected only — a `DomainError` a person can act on is caught and rendered beside
 * its control; what reaches here is a bug or an outage. `error.message` isn't shown: Next
 * forwards a generic message for anything thrown server-side, so `digest` (matching the server
 * log entry) is the only useful thing to surface. The layout survives — this replaces only the
 * content column.
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

  return (
    <div className="mt-8 max-w-prose">
      <SectionHeading>This screen did not load</SectionHeading>

      <Hint className="mt-2">
        Something went wrong reading it. Nothing was changed by the attempt, and the rest of this
        business is still reachable from the menu.
      </Hint>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>

        {error.digest ? (
          <Hint weight="subtle" className="font-mono">
            Reference {error.digest}
          </Hint>
        ) : null}
      </div>
    </div>
  );
}
