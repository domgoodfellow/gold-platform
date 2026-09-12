import { AppShell } from '@/components/containers/app-shell';
import { redirect } from 'next/navigation';
import { AreaTrail, OrganizationSwitcher, OrgNav, OrgNavBar, SetupBadge, SetupEntry } from './org-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { requireOrganization } from '@/lib/route/organization';
import { AccountMenu } from '@/components/containers/account-menu';

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
  const [enabledModules, myOrganizations, staff] = await Promise.all([
    listUsableModules(db, { organizationId }),
    listMyOrganizations(db),
    isPlatformStaff(db),
  ]);
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

  // The sidebar always has a mark to show, so its identity row is never an empty bordered box
  // in the icon-only rail or when collapsed — an uploaded logo where there is one, the
  // business's own initial otherwise.
  const mark = logo ?? (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-foreground text-sm font-semibold text-background"
    >
      {organization.name.charAt(0).toUpperCase()}
    </span>
  );

  const inSetup = organization.operationalState === 'setup';

  const sidebar = (
    <>
      <OrganizationSwitcher
        mark={mark}
        organizationId={organizationId}
        name={organization.name}
        role={organization.role}
        organizations={myOrganizations.map((org) => ({ id: org.id, name: org.name, role: org.role }))}
        platformStaff={staff}
      />

      {inSetup ? <SetupEntry organizationId={organizationId} /> : null}

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
      <AreaTrail organizationId={organizationId} />

      {inSetup ? <SetupBadge organizationId={organizationId} /> : null}

      <span className="flex-1" />
      <span className="md:hidden"><AccountMenu signOutAction={signOutAction} /></span>
    </>
  );

  const sidebarFooter = <AccountMenu signOutAction={signOutAction} />;

  return (
    // `data-brand` sits here rather than on `<html>` — a brand belongs to one business, and this layout is the only thing that knows which.
    <div data-brand className="min-h-full">
      <BrandStyle brand={brand} />
      <AppShell
        header={header}
        sidebar={sidebar}
        sidebarFooter={sidebarFooter}
        bottomBar={
          <OrgNavBar organizationId={organizationId} enabledModules={[...enabledModules]} />
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
