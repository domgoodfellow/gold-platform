import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** GildOps' commercial portfolio economics is Platform's (`/platform/economics`), not tenant Finance. Bookmark redirect only. */
export default async function LegacyFinanceEconomicsRoute() {
  redirect(`/platform/economics`);
}
