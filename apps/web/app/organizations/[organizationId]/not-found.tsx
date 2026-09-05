import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';

/**
 * What somebody sees at the address of a business that is not theirs.
 *
 * `requireOrganization` calls `notFound()` when `getOrganization` comes back empty, and it comes
 * back empty for **two different reasons that this page must not tell apart**: the business does
 * not exist, or it exists and the caller holds no membership in it. RLS gives one answer to both
 * — no row — and that is the security property, not a limitation of the query. A page that said
 * *this business exists but is not yours* would confirm the existence of a tenant to somebody
 * outside it, one URL at a time.
 *
 * So this says neither. It describes what happened to *this request* and offers the way back,
 * which is the platform speaking about application state and about nothing else.
 *
 * **It is a `not-found`, not an `error`.** `notFound()` throws a signal Next routes here rather
 * than to the error boundary, which is why this file exists separately: reaching a business that
 * is not yours is an ordinary thing to do with a stale bookmark, and it should not read as a
 * crash or offer a *Try again* that will do exactly the same thing.
 */
export default function OrganizationNotFound() {
  return (
    <main className="mx-auto max-w-prose p-6 sm:p-8">
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
