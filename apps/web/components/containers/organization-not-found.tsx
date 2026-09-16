import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';

/**
 * `requireOrganization` calls `notFound()` for both "doesn't exist" and "not yours" — RLS gives
 * one answer to both, and this page must not tell them apart either, or it would confirm a
 * tenant's existence to someone outside it.
 *
 * Rendered from two places, deliberately (`app/organizations/not-found.tsx` and
 * `app/organizations/[organizationId]/not-found.tsx`) — not a duplication to collapse. A
 * `notFound()` thrown by `[organizationId]/layout.tsx` itself (the common case: the layout reads
 * the organization to render the shell, before any page under it runs) can only be caught by an
 * *ancestor* segment's `not-found.tsx` — Next's own component hierarchy renders a segment's
 * colocated `not-found.tsx` as a sibling slot inside that segment's layout, so a layout that
 * fails cannot be rescued by the very file sitting beside it. `app/organizations/not-found.tsx`
 * is that ancestor boundary, and is what actually fires for a non-member today. The
 * `[organizationId]`-level file stays, for the one case that differs: a page *beneath* an
 * already-proven membership calling `notFound()` for its own reason (a work item, asset, or
 * customer id that doesn't exist).
 */
export function OrganizationNotFound() {
  return (
    <main className="mx-auto w-full max-w-prose p-6 sm:p-8">
      <SectionHeading>This business is not available to you</SectionHeading>

      <Hint className="mt-2">
        The address may be out of date, or this business may not be one you belong to.
      </Hint>

      <Hint className="mt-4">
        <Link href="/organizations" className="underline underline-offset-4">
          Your businesses
        </Link>
      </Hint>
    </main>
  );
}
