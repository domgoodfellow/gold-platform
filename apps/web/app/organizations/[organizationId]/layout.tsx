import { Hint } from '@/components/controls/inputs';
import {
  AppShell,
  SidebarButton,
  SidebarLabel,
  SIDEBAR_ROW,
} from '@/components/containers/app-shell';
import { cx } from '@/components/class-names';
import Link from 'next/link';
import { ArrowLeftRight, LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AreaTrail, OrgNav, OrgNavBar } from './org-shell';
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
    redirect('/login');
  }

  // The business's mark and name. Rendered in the sidebar from `md` up and in the header below
  // it, because the sidebar is not there on a phone and a screen that never says whose business
  // it is showing is the one thing worse than saying it twice.
  const logo = brand.logoPath ? (
    // A tenant's logo is a remote object in a public bucket, not a build-time asset —
    // next/image would need every deployment's storage host named in its config.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrl(db, brand.logoPath)}
      alt=""
      className="h-7 w-7 shrink-0 rounded object-contain"
    />
  ) : null;

  const sidebar = (
    <>
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-3 md:block">
          {logo ? <span className="contents md:mb-2 md:block">{logo}</span> : null}
          <SidebarLabel block>
            <span className="block min-w-0">
              <span className="block truncate font-semibold">{organization.name}</span>
              {/* The tenant's own word for the role, not a platform label (D6, D19). */}
              <Hint className="block truncate">{organization.role}</Hint>
            </span>
          </SidebarLabel>
        </div>
      </div>

      <OrgNav organizationId={organizationId} enabledModules={[...enabledModules]} />
    </>
  );

  /*
    The header. Three things, in the order somebody reads them: whose business this is (on a
    phone, where the sidebar cannot say so), where in it you are, and the two actions that belong
    to the shell rather than to any screen.

    Switch business and Sign out moved here out of the sidebar. In a column they were two rows
    sitting under sixteen areas, which put *leave this business* in the same list as *go to
    Customers*; they are not navigation and they now read as what they are. They stay plain
    rows rather than becoming `Button`s for the reason `SIDEBAR_ROW` exists — chrome declares no
    weight — and their labels appear from `sm` up, the icon and its accessible name carrying them
    on a narrow screen.
  */
  const header = (
    <>
      <span className="flex min-w-0 items-center gap-2 md:hidden">
        {logo}
        <span className="truncate font-semibold">{organization.name}</span>
      </span>

      <AreaTrail organizationId={organizationId} />

      {/* Pushes what follows to the far end, so the two actions sit together whatever the trail's length. */}
      <span className="flex-1" />

      <Link
        href="/organizations?all=1"
        aria-label="Switch business"
        title="Switch business"
        className={cx(SIDEBAR_ROW, 'shrink-0')}
      >
        <ArrowLeftRight aria-hidden size={16} className="shrink-0" />
        <span className="hidden sm:inline">Switch business</span>
      </Link>

      <form action={signOutAction} className="shrink-0">
        <SidebarButton type="submit" aria-label="Log out" title="Log out">
          <LogOut aria-hidden size={16} className="shrink-0" />
          <span className="hidden sm:inline">Log out</span>
        </SidebarButton>
      </form>
    </>
  );

  return (
    // `data-brand` sits here rather than on `<html>` — a brand belongs to one business, and this layout is the only thing that knows which.
    <div data-brand className="min-h-full">
      <BrandStyle brand={brand} />
      <AppShell
        header={header}
        sidebar={sidebar}
        bottomBar={
          <OrgNavBar organizationId={organizationId} enabledModules={[...enabledModules]} />
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
