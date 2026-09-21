import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { LockedOrgSidebar, OrgNavBar, OrgSidebar } from '@/app/organizations/[organizationId]/org-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { platformPermissions } from '@/lib/domain/platform/permissions';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { isGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import {
  activeModuleKeys,
  availableFeatureKeys,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';
import { projectShell } from '@/lib/shell';
import { CompactAccountMenu } from '@/components/containers/account-menu';
import { CompactContextSwitcher } from '@/components/containers/context-switcher';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { TenantAgentRail } from '@/features/agent/tenant-agent-rail';
import { PlatformAgentRail } from '@/features/agent/platform-agent-rail';
import { RouteAwareAgent } from '@/features/agent/route-aware-agent';
import { platformHref } from '@/lib/platform-navigation';
import { canAnswerPlatformQuestions } from '@/lib/domain/assistant/platform-questions';
import {
  canAnswerQuestions,
  listAgentConversationRuns,
  listAgentConversationSummaries,
} from '@/lib/domain/assistant/questions';

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
  const [featureStates, myOrganizations, staff, { data: userData }, conversations, canAnswer, gold] =
    await Promise.all([
      locked ? Promise.resolve([]) : organizationResolvedFeatureStates(db, { organizationId }),
      listMyOrganizations(db),
      isPlatformStaff(db),
      db.auth.getUser(),
      locked ? Promise.resolve([]) : listAgentConversationSummaries(db, { organizationId }),
      canAnswerQuestions(),
      isGoldInternalOrganization(db, { organizationId }),
    ]);
  // The shell loads a bounded list of titles and one transcript — the most recent conversation.
  // Any other transcript is fetched when somebody opens it from History.
  const latestConversation = conversations[0];
  const initialConversation = latestConversation
    ? {
        id: latestConversation.id,
        runs: await listAgentConversationRuns(db, {
          organizationId,
          conversationId: latestConversation.id,
        }),
      }
    : null;

  // Platform authority is read only for GOLD's own organization, and only for staff. Everywhere
  // else it is `null`, so the projection cannot produce a Platform section beside a customer's work.
  const platform = staff && gold ? await platformPermissions(db) : null;
  // The Platform Agent exists only where Platform does. Both Agents are built here and one is
  // mounted, by route (`RouteAwareAgent`): the shell cannot know the path, and neither Agent may
  // borrow the other's scope.
  const canAnswerPlatform = platform && platform.size > 0 ? await canAnswerPlatformQuestions() : false;
  const sections = projectShell({
    organizationId,
    enabledModules: activeModuleKeys(featureStates),
    featureAvailability: availableFeatureKeys(featureStates),
    capabilities: new Set(organization.capabilities),
    platform,
  });

  // `requireOrganization` already proved a session exists; this is a second, deliberately
  // separate read of the same session for the one extra fact the shell shows (I11's minimal
  // `Actor` shape carries only an id).
  const email = userData.user?.email ?? '';
  // Read here rather than per-screen, since a brand belongs to the shell — every page inside
  // inherits these roles and never has to know whose colour it's rendering.
  const brand = await getBrand(db, { organizationId });

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

  // The one place the shell asks whether this business is still being set up. The sidebar row and
  // the phone bar's first item both read this and nothing else, so neither can outlive Launch. It
  // is the lifecycle fact already on the organization — the shell prints no progress, so it runs
  // no readiness query; the Setup page owns the count and `launchOrganization` the guard.
  const setup = organization.operationalState === 'setup';

  const switchable = myOrganizations.map((org) => ({
    id: org.id,
    name: org.name,
    role: org.role,
    operationalState: org.operationalState,
  }));

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
      setup={setup}
      email={email}
      signOutAction={signOutAction}
    />
  );

  /*
    The global header, composed from the shared `WorkspaceHeader`. Left to right: the sidebar's
    own trigger (from `md` up, where the sidebar exists at all) and — on a phone, where the
    sidebar itself renders nothing and `OrgNavBar` carries navigation instead — the two identity
    controls the sidebar would otherwise have held: a compact context switcher and the account
    menu immediately before Agent, so Agent stays the furthest-right control at every width. A
    phone reaches Setup through `OrgNavBar`'s own first item while SETUP lasts, never through this
    header. Page identity is each page's own `PageHeader`.
  */
  const header = (
    <WorkspaceHeader
      navigationTrigger="md"
      context={
        <div className="flex min-w-0 items-center gap-3 md:hidden">
          <CompactContextSwitcher
            mark={mark}
            current={{ kind: 'business', organizationId, name: organization.name, role: organization.role }}
            organizations={switchable}
          />
        </div>
      }
      beforeActions={
        <div className="md:hidden">
          <CompactAccountMenu email={email} signOutAction={signOutAction} />
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
          locked ? undefined : <OrgNavBar organizationId={organizationId} sections={sections} setup={setup} />
        }
        agent={
          locked ? null : (
            <RouteAwareAgent
              organization={
                <TenantAgentRail
                  organizationId={organizationId}
                  organizationName={organization.name}
                  timezone={organization.timezone}
                  canAnswer={canAnswer}
                  mayAsk={organization.capabilities.includes('assistant.ask')}
                  canManageConnections={organization.capabilities.includes('integration.manage')}
                  conversations={conversations}
                  initialConversation={initialConversation}
                />
              }
              platform={
                platform && platform.size > 0 ? (
                  <PlatformAgentRail
                    canAnswer={canAnswerPlatform}
                    configureHref={platformHref(organizationId, 'providers')}
                  />
                ) : null
              }
            />
          )
        }
      >
        {children}
      </WorkspaceShell>
    </div>
  );
}
