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
 * The operator shell: persistent navigation across one business's areas. Not the authorization
 * boundary — every page still calls `requireOrganization` itself, since Next can reuse this
 * layout across client navigations without re-rendering it. This call exists so the shell can
 * render the business's name, sharing the same request-scoped read.
 */
export default async function OrganizationLayout({
  params,
  children,
}: LayoutProps<'/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const enabledModules = await listEnabledModules(db, { organizationId });
  // Read here rather than per-screen, since a brand belongs to the shell — every page inside
  // inherits these roles and never has to know whose colour it's rendering.
  const brand = await getBrand(db, { organizationId });

  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/sign-in');
  }

  return (
    // `data-brand` sits here rather than on `<html>` — a brand belongs to one business, and this layout is the only thing that knows which.
    <div data-brand className="min-h-full md:grid md:grid-cols-[5rem_1fr] lg:grid-cols-[15rem_1fr]">
      <BrandStyle brand={brand} />
      <aside className="border-b border-border md:sticky md:top-0 md:h-dvh md:overflow-y-auto md:border-r md:border-b-0">
        <div className="flex items-baseline justify-between gap-3 px-4 pt-4 md:block">
          <div className="min-w-0">
            {brand.logoPath ? (
              // A tenant's logo is a remote object in a public bucket, not a build-time asset —
              // next/image would need every deployment's storage host named in its config.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl(db, brand.logoPath)}
                alt={organization.name}
                className="mb-2 max-h-8 w-auto max-w-full object-contain"
              />
            ) : null}
            <p className="truncate font-semibold">{organization.name}</p>
            {/* The tenant's own word for the role, not a platform label (D6, D19). */}
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

      <div className="min-w-0">
        {/* `pb-24` on phones reserves room for the fixed bottom nav; from `md` the nav is a column and this goes away. */}
        <main className="mx-auto max-w-3xl p-6 pb-24 sm:p-8 md:pb-8">
          <AreaHeading />
          {children}
        </main>
      </div>
    </div>
  );
}
