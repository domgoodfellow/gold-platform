'use client';

import { useEffect } from 'react';

/**
 * Keeps an old in-page anchor working after its section moved to its own page. A fragment never
 * reaches the server, so the page that used to hold it forwards the browser, replacing the address.
 */
export function LegacyAnchorRedirect({ anchors }: { anchors: Readonly<Record<string, string>> }) {
  useEffect(() => {
    const target = anchors[window.location.hash.slice(1)];
    if (target) window.location.replace(target);
  }, [anchors]);
  return null;
}
