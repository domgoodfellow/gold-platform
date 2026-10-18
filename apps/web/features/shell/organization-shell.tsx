import { WORKSPACES, workspaceConfigureItems, configTarget } from '@/lib/navigation';
import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { OrganizationFrame } from '@/app/organizations/[organizationId]/org-shell';
import { logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';
import { loadOrganizationShellModel } from '@/lib/application/shell/organization-shell';
import { TenantAgentRail } from '@/features/agent/tenant-agent-rail';
import { offeredSections } from '@/features/settings/settings-map';
import { projectSettingsNav, settingsSearchItems } from '@/lib/settings-nav';
import { AccountAppearance } from '@/features/appearance/account-appearance';
import { BusinessVocabulary } from '@/lib/context/business-vocabulary';

/** The one frame for every organization, GildOps' own Administration included, with canonical
 * server authority resolution. Each page still enforces its own access; layouts persist across
 * client navigations.
 */
export async function OrganizationShell({
  organizationId,
  children,
  feedback,
}: {
  organizationId: string;
  children: ReactNode;
  feedback?: ReactNode;
}) {
  const { db, organization, access } = await requireOrganizationForBillingRecovery(organizationId);
  const locked = !access.permitted;
  // A locked business runs none of the workspace reads below — no feature resolution and no
  // Agent transcript — because none of it is drawn.
  const { brand, businessProfile, email, switchable, sections, utilities, configGate } = await loadOrganizationShellModel(db, {
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
  // separate read of the same session for the one extra fact the shell shows (actor attribution's minimal
  // `Actor` shape carries only an id).
  // Read here rather than per-screen, since a brand belongs to the shell — every page inside
  // inherits these roles and never has to know whose colour it's rendering.

  // Settings is a context of this same shell: its destinations replace the workspaces in the
  // sidebar while a person is inside it, and search reaches the configuration workspaces own.
  const settings = locked ? [] : projectSettingsNav(organizationId, configGate);
  const settingsSearch = locked ? [] : settingsSearchItems(organizationId, settings, [
    ...offeredSections(configGate).flatMap(section => section.entries),
    ...WORKSPACES.flatMap(workspace => workspaceConfigureItems(organizationId, workspace.key, configGate)).map(section => ({ key: section.key.split('#')[0], title: section.label, description: 'Workspace configuration', path: configTarget(section.key.split('#')[0]).path })),
  ].filter((entry, index, entries) => entries.findIndex(candidate => candidate.path === entry.path) === index));

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

  return (
    // `data-brand` sits here rather than on `<html>` — a brand belongs to one business, and this shell is the only thing that knows which.
    <AccountAppearance brand={brand}>
      <BusinessVocabulary profile={businessProfile}>
      <OrganizationFrame
        organizationId={organizationId}
        name={organization.name}
        role={organization.role}
        mark={mark}
        organizations={switchable}
        sections={sections}
        utilities={utilities}
        settings={settings}
        settingsSearch={settingsSearch}
        locked={locked}
        email={email}
        signOutAction={signOutAction}
        agent={
          locked ? null : (
            <TenantAgentRail
              organizationId={organizationId}
              organizationName={organization.name}
              timezone={organization.timezone}
              mayAsk={organization.capabilities.includes('assistant.ask')}
              canManageAgent={organization.capabilities.includes('organization.manage')}
            />
          )
        }
      >
        {children}
      </OrganizationFrame>
      {feedback}
      </BusinessVocabulary>
    </AccountAppearance>
  );
}
