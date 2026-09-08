import Link from 'next/link';
import { Hint } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/containers/section';

/**
 * `requireOrganization` calls `notFound()` for both "doesn't exist" and "not yours" — RLS gives
 * one answer to both, and this page must not tell them apart either, or it would confirm a
 * tenant's existence to someone outside it.
 */
export default function OrganizationNotFound() {
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
