import {
  AppShell,
  SidebarButton,
  SIDEBAR_ROW,
} from '@/components/containers/app-shell';
import { cx } from '@/components/class-names';
import Link from 'next/link';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AreaTrail, OrganizationSwitcher, OrgNav, OrgNavBar, SetupBadge, SetupEntry } from './org-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
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
  const enabledModules = await listUsableModules(db, { organizationId });
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
        name={organization.name}
        role={organization.role}
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
      <details className="group relative min-w-0 md:hidden">
        <summary className={cx('flex cursor-pointer list-none items-center gap-2 marker:content-none', SIDEBAR_ROW)}>
          {logo}
          <span className="max-w-28 truncate font-semibold">{organization.name}</span>
          <ChevronDown aria-hidden size={14} className="shrink-0 group-open:rotate-180" />
        </summary>
        <div className="absolute left-0 top-[calc(100%+0.5rem)] z-30 w-48 rounded border border-border bg-surface p-1 shadow-lg">
          <Link href="/organizations?all=1" className={cx(SIDEBAR_ROW, 'w-full')}>All businesses</Link>
        </div>
      </details>

      <AreaTrail organizationId={organizationId} />

      {inSetup ? <SetupBadge organizationId={organizationId} /> : null}

      <span className="flex-1" />
      <details className="group relative shrink-0 md:hidden">
        <summary className={cx(SIDEBAR_ROW, 'cursor-pointer list-none marker:content-none')} aria-label="Account menu">
          <UserRound aria-hidden size={16} />
          <span className="sr-only">Account menu</span>
        </summary>
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-44 rounded border border-border bg-surface p-1 shadow-lg">
          <form action={signOutAction}>
            <SidebarButton type="submit">
              <LogOut aria-hidden size={16} /> Log out
            </SidebarButton>
          </form>
        </div>
      </details>
    </>
  );

  const sidebarFooter = (
    <details className="group relative">
      <summary className={cx(SIDEBAR_ROW, 'cursor-pointer list-none px-4 py-3 marker:content-none')}>
        <UserRound aria-hidden size={18} className="shrink-0" />
        <span className="md:hidden lg:inline">Account</span>
      </summary>
      <div className="absolute inset-x-2 bottom-[calc(100%+0.25rem)] z-30 rounded border border-border bg-surface p-1 shadow-lg">
        <form action={signOutAction}>
          <SidebarButton type="submit">
            <LogOut aria-hidden size={16} />
            <span>Log out</span>
          </SidebarButton>
        </form>
      </div>
    </details>
  );

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
