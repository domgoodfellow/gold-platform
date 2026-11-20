import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Plans moved to Product Registry, which keeps what each plan switches on (ADR-057). Kept so a bookmark still lands. */
export default function RetiredPlatformPlansRoute(): never {
  redirect('/platform/catalog/plans');
}
