import { ButtonLink } from '@/components/controls/button';
import { FallbackPage } from '@/components/containers/fallback-page';
import { GlobalFallbackShell } from '@/features/account/global-fallback-shell';

/**
 * `requireOrganization` calls `notFound()` for both "doesn't exist" and "not yours" — RLS gives
 * one answer to both, and neither fallback below may tell them apart, or it would confirm a
 * tenant's existence to someone outside it. Neither names, brands or lists a business.
 *
 * Two different fallbacks, because two different things are known:
 *
 * - **`OrganizationUnavailable`** — the organization itself could not be proven. Rendered by
 *   `app/organizations/not-found.tsx`, the *ancestor* boundary: a `notFound()` thrown by
 *   `[organizationId]/layout.tsx` (the common case — it reads the organization to draw the shell,
 *   before any page runs) can only be caught above that layout, never by the colocated file, which
 *   Next renders as a slot inside the very layout that failed. With no membership proven there is
 *   no organization shell to keep, so it stands in `GlobalFallbackShell`: the person's own
 *   context and nothing about the requested business.
 * - **`OrganizationPageNotFound`** — membership *was* proven (the layout rendered) and something
 *   beneath it is missing: an unknown address, or a work item, asset or customer id that does not
 *   exist. Rendered by `[organizationId]/not-found.tsx`, so it fills the content column of the
 *   real organization shell and needs to say nothing about which business that is.
 */
export function OrganizationUnavailable() {
  return (
    <GlobalFallbackShell>
      {(recovery) => (
        <FallbackPage
          title="This business is not available"
          description="The address may be out of date, or this business may not be one you belong to."
          action={<ButtonLink href={recovery.href}>{recovery.label}</ButtonLink>}
        />
      )}
    </GlobalFallbackShell>
  );
}

export function OrganizationPageNotFound() {
  return (
    <FallbackPage
      title="This page does not exist"
      description="The address may have changed, or the page may no longer be available."
      // `/organizations` is the landing mechanism, not a directory: it sends a signed-in person
      // where a sign-in would, which for somebody already working in a business is that business.
      action={<ButtonLink href="/organizations">Return to workspace</ButtonLink>}
    />
  );
}
