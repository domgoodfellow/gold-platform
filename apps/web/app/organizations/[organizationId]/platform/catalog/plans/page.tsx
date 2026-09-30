import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Plans & Add-ons moved to Finance (the commercial-packaging side of D25's Catalogue/Plan split):
 * GildOps Admin → Platform keeps Products, Modules and Features — what can exist; Finance now
 * owns how it is packaged, priced and sold. Kept only so a bookmark still lands somewhere; nothing
 * in the application generates this link any more.
 */
export default async function LegacyPlatformPlansRoute({ params, searchParams }: PageProps<'/organizations/[organizationId]/platform/catalog/plans'> & { searchParams: Search }) {
  const { organizationId } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  const search = query.size > 0 ? `?${query.toString()}` : '';
  redirect(`/organizations/${organizationId}/finance/plans${search}`);
}
