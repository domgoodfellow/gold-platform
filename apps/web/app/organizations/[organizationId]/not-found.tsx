import { OrganizationPageNotFound } from '@/features/account/organization-not-found';

/**
 * Catches a `notFound()` thrown *beneath* an already-proven membership — an address that matches
 * no route (`[...unmatched]`), or a page calling it for its own reason (a work item, asset,
 * customer or similar id that doesn't exist). It renders inside `[organizationId]/layout.tsx`, so
 * the real organization shell surrounds it. The far more common refusal — a non-member, caught by
 * that layout itself — cannot be caught here; see `app/organizations/not-found.tsx`.
 */
export default function OrganizationScopedNotFound() {
  return <OrganizationPageNotFound />;
}
