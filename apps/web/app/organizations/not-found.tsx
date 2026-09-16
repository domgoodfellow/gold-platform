import { OrganizationNotFound } from '@/components/containers/organization-not-found';

/**
 * The boundary that actually catches a non-member's visit to `/organizations/{id}` and everything
 * under it. `[organizationId]/layout.tsx` reads the organization itself (to render the shell) and
 * calls `notFound()` on a non-member before any page beneath it runs — and a `notFound()` thrown
 * by a layout can only be caught by an *ancestor* segment's `not-found.tsx`, never its own
 * segment's colocated one (Next's component hierarchy renders that file as a sibling slot inside
 * the same layout, so a broken layout can't be rescued by the file sitting beside it). This file
 * is that ancestor. See `OrganizationNotFound` for why the copy lives in one shared component
 * rather than being written twice.
 */
export default function OrganizationsNotFound() {
  return <OrganizationNotFound />;
}
