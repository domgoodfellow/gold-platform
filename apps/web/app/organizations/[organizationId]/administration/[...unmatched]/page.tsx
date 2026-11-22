import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * An address beneath `/organizations/{id}/platform` that matches no route. Without a page inside this segment Next
 * renders the root `not-found.tsx` outside the Platform layout, ejecting an operator into the
 * public 404. Throwing here lets `platform/not-found.tsx` render inside the layout — which has
 * already required platform staff, so a non-operator never reaches this page at all.
 */
export default function UnmatchedPlatformRoute() {
  notFound();
}
