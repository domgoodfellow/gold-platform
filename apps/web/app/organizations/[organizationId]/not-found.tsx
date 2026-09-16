import { OrganizationNotFound } from '@/components/containers/organization-not-found';

/**
 * Catches a `notFound()` thrown *beneath* an already-proven membership — a page under this
 * organization calling it for its own reason (a work item, asset, customer or similar id that
 * doesn't exist). The far more common case — a non-member, caught by `[organizationId]/layout.tsx`
 * itself — cannot be caught here; see `app/organizations/not-found.tsx` and the comment on
 * `OrganizationNotFound`.
 */
export default function OrganizationScopedNotFound() {
  return <OrganizationNotFound />;
}
