import { Hint } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AreaHeading, OrgNav } from './org-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';
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
  const { db, organization } = await requireOrganization(organizationId);
  // Read server-side under RLS, then handed to the client component. What a business has
  // switched on is not a secret and not a permission — it decides which of its own areas it
  // sees, and the screens themselves are guarded by policies either way.
  const enabledModules = await listEnabledModules(db, { organizationId });
  // **Read here rather than per screen, because a brand is the shell.** Every page inside this
  // layout inherits the roles below, so a screen never asks for a colour and never learns whose
  // it is. Read under RLS like everything else: a member sees their own business's row.
  const brand = await getBrand(db, { organizationId });

  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/sign-in');
  }

  return (
    // `data-brand` is what `BrandStyle`'s rule is keyed to, and it sits here rather than on
    // `<html>` because a brand belongs to one business and this layout is the only thing that
    // knows which one. The sign-in page and the business list have no tenant and stay the
    // platform's own.
    <div data-brand className="min-h-full md:grid md:grid-cols-[15rem_1fr]">
      <BrandStyle brand={brand} />
      <aside className="border-b border-border md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4 md:block">
          <div className="min-w-0">
            {/* The business, in its own name and — when it has put one up — its own mark.
                Every screen used to repeat the name under its own heading; it belongs to the
                shell, not to nine pages. */}
            {brand.logoPath ? (
              // A tenant's logo is an arbitrary remote object in a public bucket, not a
              // build-time asset, and `next/image` would need every deployment's storage host
              // named in its config.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl(db, brand.logoPath)}
                alt={organization.name}
                className="mb-2 max-h-8 w-auto max-w-full object-contain"
              />
            ) : null}
            <p className="truncate font-semibold">{organization.name}</p>
            {/* The role is the tenant's word for it, not a platform label (D6, D19). */}
            <Hint className="truncate">{organization.role}</Hint>
          </div>
          <Link
            href="/organizations"
            className="shrink-0 text-sm underline underline-offset-4 text-muted md:mt-3 md:inline-block"
          >
            Switch business
          </Link>
        </div>

        <OrgNav organizationId={organizationId} enabledModules={[...enabledModules]} />

        <form action={signOutAction} className="px-4 pb-4 md:pt-2">
          <Button type="submit" tone="text" size="small">
            Sign out
          </Button>
        </form>
      </aside>

      {/* `min-w-0` so a wide child — the schedule's rows, a long custom field value —
          scrolls inside the column instead of stretching the grid and pushing the sidebar
          off screen. */}
      <div className="min-w-0">
        {/* `pb-24` on phones is not spacing — it is the room the fixed bottom navigation
            occupies. Without it the last control on every screen sits underneath the bar and
            cannot be tapped. From `md` the bar is a column and the reservation goes away. */}
        <main className="mx-auto max-w-3xl p-6 pb-24 sm:p-8 md:pb-8">
          <AreaHeading />
          {children}
        </main>
      </div>
    </div>
  );
}
