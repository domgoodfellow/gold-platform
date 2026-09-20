import { redirect } from 'next/navigation';
import { OrgNavBar, OrgSidebar } from './org-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import {
  activeModuleKeys,
  availableFeatureKeys,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { requireOrganization } from '@/lib/route/organization';
import { platformAdministrationAvailable } from '@/lib/route/platform-context';
import { CompactAccountMenu } from '@/components/containers/account-menu';
import { CompactContextSwitcher } from '@/components/containers/context-switcher';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { TenantAgentRail } from '@/features/agent/tenant-agent-rail';
import { canAnswerQuestions, listAgentRuns } from '@/lib/domain/assistant/questions';

/**
 * The operator shell: persistent navigation across one business's areas. Not the authorization
 * boundary — every page still calls `requireOrganization` itself, since Next can reuse this
 * layout across client navigations without re-rendering it. This call exists so the shell can
 * render the business's name, sharing the same request-scoped read.
 *
 * Because this call runs here too, a non-member's `notFound()` is thrown by this layout itself,
 * not by whichever page they reached — and the file that actually renders for that is
 * `app/organizations/not-found.tsx`, an ancestor segment, not this segment's own
 * `not-found.tsx`. See that file's comment for why.
 */
export default async function OrganizationLayout({
  params,
  children,
}: LayoutProps<'/organizations/[organizationId]'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const [featureStates, myOrganizations, staff, { data: userData }, agentRuns, canAnswer] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId }),
    listMyOrganizations(db),
    isPlatformStaff(db),
    db.auth.getUser(),
    listAgentRuns(db, { organizationId }),
    canAnswerQuestions(),
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
  const goldInternal = await findGoldInternalOrganization(db, myOrganizations);
  const isGoldInternal = goldInternal?.id === organizationId;
  const platformAdministration = platformAdministrationAvailable({ staff, goldInternal });
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

  const sidebar = (
    <OrgSidebar
      organizationId={organizationId}
      mark={mark}
      name={organization.name}
      role={organization.role}
      organizations={switchable}
      platformAdministration={platformAdministration}
      platformStaff={staff}
      isGoldInternal={isGoldInternal}
      enabledModules={[...enabledModules]}
      featureAvailability={[...featureAvailability]}
      capabilities={organization.capabilities}
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
            platformAdministration={platformAdministration}
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
    // `data-brand` sits here rather than on `<html>` — a brand belongs to one business, and this layout is the only thing that knows which.
    <div data-brand className="min-h-full">
      <BrandStyle brand={brand} />
      <WorkspaceShell
        sidebar={sidebar}
        header={header}
        bottomBar={
          <OrgNavBar
            organizationId={organizationId}
            enabledModules={[...enabledModules]}
            featureAvailability={[...featureAvailability]}
            capabilities={organization.capabilities}
            platformStaff={staff}
            isGoldInternal={isGoldInternal}
            setup={setup}
          />
        }
        agent={
          <TenantAgentRail
            organizationId={organizationId}
            organizationName={organization.name}
            canAnswer={canAnswer}
            mayAsk={organization.capabilities.includes('assistant.ask')}
            runs={agentRuns}
          />
        }
      >
        {children}
      </WorkspaceShell>
    </div>
  );
}
