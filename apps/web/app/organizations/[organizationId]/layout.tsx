import { AppShell } from '@/components/containers/app-shell';
import { redirect } from 'next/navigation';
import { AreaTrail, OrgNavBar, OrgSidebar, SetupBadge, SetupEntry } from './org-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import {
  activeModuleKeys,
  availableFeatureKeys,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';
import { AccountMenu } from '@/components/containers/account-menu';
import { Separator } from '@gold/ui/components/separator';
import { SidebarTrigger } from '@gold/ui/components/sidebar';

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
  const [featureStates, myOrganizations, staff, { data: userData }] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    listMyOrganizations(db),
    isPlatformStaff(db),
    db.auth.getUser(),
  ]);
  // The shell's navigation gate, resolved once for both desktop and mobile (`OrgSidebar`/`OrgNav`
  // and `OrgNavBar` share the one `visibleAreas`/`areasIn` predicate in `lib/navigation.ts`).
  // `enabledModules` still answers the legacy module-key question — for the kernel and for an
  // area like Guided Setup whose module has no canonical Feature mapping yet — but through the
  // canonical resolver's own override-aware `activeModuleKeys`, not a raw `listUsableModules`
  // read: a business that has disabled every Feature backing a module must not still see that
  // module as "on" here. `featureAvailability` is the new, finer-grained layer `Area.featureKeys`
  // resolve against.
  const enabledModules = activeModuleKeys(featureStates);
  const featureAvailability = availableFeatureKeys(featureStates);
  // `requireOrganization` already proved a session exists; this is a second, deliberately
  // separate read of the same session for the one extra fact the shell shows (I11's minimal
  // `Actor` shape carries only an id).
  const email = userData.user?.email ?? '';
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
    <OrgSidebar
      organizationId={organizationId}
      mark={mark}
      name={organization.name}
      role={organization.role}
      organizations={myOrganizations.map((org) => ({ id: org.id, name: org.name, role: org.role }))}
      platformStaff={staff}
      enabledModules={[...enabledModules]}
      featureAvailability={[...featureAvailability]}
      capabilities={organization.capabilities}
      setupEntry={inSetup ? <SetupEntry organizationId={organizationId} /> : null}
      email={email}
      signOutAction={signOutAction}
    />
  );

  /*
    The header. Three things, in the order somebody reads them: the sidebar's own trigger (from
    `md` up, where the sidebar exists at all), where in it you are, and the two actions that
    belong to the shell rather than to any screen.

    Switch business and Sign out live in the sidebar footer's account menu, not the header list
    of areas — they are not navigation. On a phone, where the sidebar itself renders nothing
    (`OrgNavBar` carries navigation instead), the same account menu appears here so the actions
    are not lost at that width.
  */
  const header = (
    <header className="sticky top-0 z-20 flex h-(--header-height) shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
      <SidebarTrigger className="hidden -ml-2 md:flex" />
      <Separator orientation="vertical" className="hidden data-[orientation=vertical]:h-4 md:block" />

      <AreaTrail organizationId={organizationId} />

      {inSetup ? <SetupBadge organizationId={organizationId} /> : null}

      <span className="flex-1" />
      <div className="md:hidden"><AccountMenu email={email} signOutAction={signOutAction} /></div>
    </header>
  );

  return (
    // `data-brand` sits here rather than on `<html>` — a brand belongs to one business, and this layout is the only thing that knows which.
    <div data-brand className="min-h-full">
      <BrandStyle brand={brand} />
      <AppShell
        sidebar={sidebar}
        header={header}
        bottomBar={
          <OrgNavBar
            organizationId={organizationId}
            enabledModules={[...enabledModules]}
            featureAvailability={[...featureAvailability]}
            capabilities={organization.capabilities}
          />
        }
      >
        {children}
      </AppShell>
    </div>
  );
}
