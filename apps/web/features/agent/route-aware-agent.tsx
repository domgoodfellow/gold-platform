'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { inPlatformScope } from '@/lib/shell';

/**
 * Chooses which Agent the shell hosts, by where the person is: the organization's own Agent
 * everywhere, and the Platform Agent beneath `/organizations/{goldId}/platform/**`. Exactly one is
 * mounted at a time — each registers the rail's content when it mounts and clears it when it
 * unmounts, so two mounted together would race for the one panel.
 *
 * Only a choice between two elements the server already built. It merges nothing: the Platform
 * Agent has no organization id and no conversation, the organization Agent answers as the caller
 * about one business, and sharing a shell does not make either the other's data. `platform` is
 * `null` outside GOLD's own organization or for somebody who is not an operator, and then the
 * organization Agent is the only one there is.
 */
export function RouteAwareAgent({
  organization,
  platform,
}: {
  organization: ReactNode;
  platform: ReactNode | null;
}) {
  const pathname = usePathname();
  return platform && inPlatformScope(pathname) ? platform : organization;
}
