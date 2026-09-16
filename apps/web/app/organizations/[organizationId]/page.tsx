import { redirect } from 'next/navigation';
import { organizationHomeHref } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

/**
 * `/organizations/{id}` itself — a doorway, not a dashboard. It exists so a bookmark, a typed
 * URL, or a link built before an area existed still lands somewhere real rather than the global
 * 404. `requireOrganization` is the same guard every area page calls (a layout is never the
 * authorization boundary — see its own comment): anonymous is sent to `/login`, a caller with no
 * membership here gets the tenant-safe `not-found.tsx` in this route segment, and only a real
 * member reaches the redirect below, into `organizationHomeHref` — the same destination
 * `ContextSwitcher`, `/organizations` and post-auth landing all use.
 */
export default async function OrganizationRootPage({
  params,
}: PageProps<'/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  redirect(organizationHomeHref(organizationId));
}
