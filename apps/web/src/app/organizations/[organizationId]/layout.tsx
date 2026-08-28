import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AreaHeading, OrgNav } from '@/components/org-shell';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireOrganization } from '@/lib/route/organization';

/**
 * The operator shell: persistent navigation across one business's areas.
 *
 * Before this, every screen began with a back-link to `/organizations` and the only way from
 * Work to Customers was through the index — nine pages that knew about no other page.
 * `roadmap.md` records that as a deliberate deferral rather than an oversight, because M3
 * rebuilds these screens anyway and styling them twice was the waste.
 *
 * The guard here is not the boundary and is not relied on as one. Every page calls
 * `requireOrganization` for itself, because Next reuses a layout across client-side
 * navigations without re-rendering it — see that function for the full reasoning. This call
 * exists so the shell can render the business's name, and it is free: the two share one
 * request-scoped read.
 */
export default async function OrganizationLayout({
  params,
  children,
}: LayoutProps<'/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  const { organization } = await requireOrganization(organizationId);

  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/sign-in');
  }

  return (
    <div className="min-h-full md:grid md:grid-cols-[15rem_1fr]">
      <aside className="border-b border-black/10 md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-r md:border-b-0 dark:border-white/15">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4 md:block">
          <div className="min-w-0">
            {/* The business, in its own name. Every screen used to repeat this under its
                own heading; it belongs to the shell, not to nine pages. */}
            <p className="truncate font-semibold">{organization.name}</p>
            {/* The role is the tenant's word for it, not a platform label (D6, D19). */}
            <p className="truncate text-sm opacity-70">{organization.role}</p>
          </div>
          <Link
            href="/organizations"
            className="shrink-0 text-sm underline underline-offset-4 opacity-70 md:mt-3 md:inline-block"
          >
            Switch business
          </Link>
        </div>

        <OrgNav organizationId={organizationId} />

        <form action={signOutAction} className="px-4 pb-4 md:pt-2">
          <button type="submit" className="text-sm underline underline-offset-4 opacity-70">
            Sign out
          </button>
        </form>
      </aside>

      {/* `min-w-0` so a wide child — the schedule's rows, a long custom field value —
          scrolls inside the column instead of stretching the grid and pushing the sidebar
          off screen. */}
      <div className="min-w-0">
        <main className="mx-auto max-w-3xl p-6 sm:p-8">
          <AreaHeading />
          {children}
        </main>
      </div>
    </div>
  );
}
