import { notFound } from 'next/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * An address beneath a business that matches no route. Next renders the *root* `not-found.tsx` for
 * an unmatched URL — outside every segment layout — so without this the person would be ejected
 * from the workspace into the public 404. Throwing from a page inside the organization segment
 * lets `[organizationId]/not-found.tsx` render within the real shell instead.
 *
 * It proves membership itself first, like every page here (I12): a non-member is refused by
 * `requireOrganization` exactly as anywhere else, so an unknown address never distinguishes a
 * business that exists from one that does not.
 */
export default async function UnmatchedOrganizationRoute({
  params,
}: PageProps<'/organizations/[organizationId]/[...unmatched]'>) {
  const { organizationId } = await params;
  await requireOrganization(organizationId);
  notFound();
}
