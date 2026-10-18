import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * Plans & Add-ons is GildOps' commercial control plane and lives at `/platform/plans`. Kept only so
 * a bookmark still lands somewhere; nothing in the application generates this link, and the
 * destination re-proves platform authority on its own.
 */
export default async function LegacyFinancePlansRoute({ searchParams }: PageProps<'/organizations/[organizationId]/finance/plans'> & { searchParams: Search }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, entry);
  }
  const search = query.size > 0 ? `?${query.toString()}` : '';
  redirect(`/platform/plans${search}`);
}
