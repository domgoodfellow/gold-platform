import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { LockedOrgSidebar, OrgNavBar, OrgSidebar } from '@/app/organizations/[organizationId]/org-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';
import { loadOrganizationShellModel } from '@/lib/application/shell/organization-shell';
import { CompactContextSwitcher } from '@/components/navigation/context-switcher';
import { WorkspaceHeader } from '@/components/headers/workspace-header';
import { WorkspaceShell } from '@/components/layout/workspace-shell';
import { TenantAgentRail } from '@/features/agent/tenant-agent-rail';

/**
 * The one application shell, for one organization. Everything beneath `/organizations/{id}` renders
 * inside it — Platform Administration included, which is `/organizations/{goldId}/platform`, a
 * privileged sub-scope of GOLD's own organization — so a person meets one recognisable frame
 * whatever they are doing, and moves between businesses with the context switcher alone.
 *
 * Not the authorization boundary: every page still calls `requireOrganization` (or its platform
 * guard) itself, since Next can reuse a layout across client navigations without re-rendering it.
 * What this does is **project**: it reads the organization's entitlements, the member's permissions
 * and — only when this organization is GOLD's own — their platform permissions, and resolves them
 * once into the sections every renderer draws (`projectShell`). Platform is a scope, so it appears
 * only here, only for an operator whose `platform_staff` row names a permission, and never beside a
 * customer's own business.
 *
 * It uses the billing-recovery guard, not `requireOrganization`, on purpose: while commercial
 * service access is locked the shell must still draw (a coherent GOLD frame around the locked
 * screen and Plan & usage), so the service question is answered here only to choose which shell to
 * draw. Every operational page and action then refuses the locked business for itself.
 *
 * Because that call runs here, a non-member's `notFound()` is thrown by this shell itself — the file
 * that renders for it is `app/organizations/not-found.tsx`, an ancestor segment. See its comment.
 */
export async function OrganizationShell({
  organizationId,
  children,
}: {
  organizationId: string;
  children: ReactNode;
}) {
  const { db, organization, access } = await requireOrganizationForBillingRecovery(organizationId);
  const locked = !access.permitted;
  // A locked business runs none of the workspace reads below — no feature resolution and no
  // Agent transcript — because none of it is drawn.
  const { brand, email, switchable, sections, settingsOffered } = await loadOrganizationShellModel(db, {
    organizationId,
    capabilities: organization.capabilities,
    locked,
  });
  // The shell loads a bounded list of titles and one transcript — the most recent conversation.
  // Any other transcript is fetched when somebody opens it from History.

  // Platform is a route scope inside this same organization (`/organizations/{goldId}/platform/**`),
  // never a second organization: the Agent stays the one built for this business throughout,
  // including on a Platform page, rather than forking by pathname into a second implementation with
  // a wider, cross-tenant answering scope it does not have.

  // `requireOrganization` already proved a session exists; this is a second, deliberately
  // separate read of the same session for the one extra fact the shell shows (I11's minimal
  // `Actor` shape carries only an id).
  // Read here rather than per-screen, since a brand belongs to the shell — every page inside
  // inherits these roles and never has to know whose colour it's rendering.

  async function signOutAction() {
    'use server';
    const actionDb = await getDb();
    await signOut(actionDb);
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

  // The one place the shell asks whether this business is still being set up. The sidebar row reads
  // this and nothing else, so it cannot outlive Launch. It is the lifecycle fact already on the
  // organization — the shell prints no progress, so it runs no readiness query; the Setup page owns
  // the count and `launchOrganization` the guard.
  const sidebar = locked ? (
    <LockedOrgSidebar
      organizationId={organizationId}
      mark={mark}
      name={organization.name}
      role={organization.role}
      organizations={switchable}
      email={email}
      signOutAction={signOutAction}
    />
  ) : (
    <OrgSidebar
      organizationId={organizationId}
      mark={mark}
      name={organization.name}
      role={organization.role}
      organizations={switchable}
      sections={sections}
      email={email}
      signOutAction={signOutAction}
      businessSettingsOffered={settingsOffered}
    />
  );

  /*
    The global header, composed from the shared `WorkspaceHeader`.
    - Phone, unlocked: the compact context switcher and the breadcrumb. Home, AI and Menu are the bottom
      bar; Account lives in the Menu sheet's footer and Agent is the bar's AI, so the header has neither.
    - Phone, locked: there is no bottom bar, so the sidebar trigger shows (`navigationTrigger="always"`)
      and opens `LockedOrgSidebar` — Plan & usage and the account menu — beside the same switcher.
    - Tablet and desktop: the sidebar trigger, the breadcrumb and Agent, the furthest-right control.
    Page identity is each page's own `PageHeader`.
  */
  const header = (
    <WorkspaceHeader
      navigationTrigger={locked ? 'always' : 'md'}
      agentTrigger="md"
      context={
        <div className="flex min-w-0 items-center gap-3 md:hidden">
          <CompactContextSwitcher
            mark={mark}
            current={{ kind: 'business', organizationId, name: organization.name, role: organization.role }}
            organizations={switchable}
          />
        </div>
      }
    />
  );

  return (
    // `data-brand` sits here rather than on `<html>` — a brand belongs to one business, and this shell is the only thing that knows which.
    <div data-brand className="min-h-full">
      <BrandStyle brand={brand} />
      <WorkspaceShell
        sidebar={sidebar}
        header={header}
        bottomBar={
          locked ? undefined : <OrgNavBar sections={sections} />
        }
        agent={
          locked ? null : (
            <TenantAgentRail
              organizationId={organizationId}
              organizationName={organization.name}
              timezone={organization.timezone}
              mayAsk={organization.capabilities.includes('assistant.ask')}
              canManageConnections={organization.capabilities.includes('integration.manage')}
            />
          )
        }
      >
        {children}
      </WorkspaceShell>
    </div>
  );
}
