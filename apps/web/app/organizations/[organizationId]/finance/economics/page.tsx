import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** GildOps' commercial portfolio economics is Platform's (`/platform/economics`), not tenant Finance. Bookmark redirect only. */
export default async function LegacyFinanceEconomicsRoute({ params }: PageProps<'/organizations/[organizationId]/finance/economics'>) {
  const { organizationId } = await params;
  redirect(`/organizations/${organizationId}/platform/economics`);
}
