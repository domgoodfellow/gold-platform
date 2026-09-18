import { redirect } from 'next/navigation';
import { CompactAccountMenu } from '@/components/containers/account-menu';
import { CompactContextSwitcher } from '@/components/containers/context-switcher';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { BrandStyle } from '@/features/branding/brand-style';
import { PlatformAgentRail } from '@/features/agent/platform-agent-rail';
import { getBrand, logoUrl } from '@/lib/domain/branding/brand';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { canAnswerPlatformQuestions } from '@/lib/domain/assistant/platform-questions';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import {
  activeModuleKeys,
  availableFeatureKeys,
  organizationResolvedFeatureStates,
} from '@/lib/domain/catalogue/organization-plans';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import {
  OrgNavBar,
  OrgSidebar,
  PlatformTrail,
  SetupBadge,
  SetupEntry,
} from '@/app/organizations/[organizationId]/org-shell';

export default async function PlatformLayout({ children }: LayoutProps<'/platform'>) {
  const db = await getDb();
  let email: string;
  try {
    const actor = await requireActor(db);
    const { data } = await db.auth.getUser();
    email = data.user?.email ?? actor.id;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') redirect('/login');
    throw error;
  }

  const platformStaff = await isPlatformStaff(db);
  if (!platformStaff) redirect('/organizations');

  const myOrganizations = await listMyOrganizations(db);
  const goldInternal = await findGoldInternalOrganization(db, myOrganizations);

  async function signOutAction() {
    'use server';
    const actionDb = await getDb();
    await signOut(actionDb);
    redirect('/login');
  }

  if (!goldInternal) {
    console.error('GOLD Internal workspace invariant is not satisfied for platform route.', {
      platformStaff,
      membershipOrganizationIds: myOrganizations.map((organization) => organization.id),
    });
    throw new DomainError(
      'GOLD Internal workspace is not configured for this platform operator.',
      'gold_internal.configuration_required',
    );
  }

  const organization = myOrganizations.find((candidate) => candidate.id === goldInternal.id);
  if (!organization) {
    throw new DomainError('GOLD Internal membership was not available.', 'gold_internal.membership_required');
  }

  const [featureStates, brand, canAnswerAgent] = await Promise.all([
    organizationResolvedFeatureStates(db, { organizationId: organization.id }),
    getBrand(db, { organizationId: organization.id }),
    canAnswerPlatformQuestions(),
  ]);

  const enabledModules = activeModuleKeys(featureStates);
  const featureAvailability = availableFeatureKeys(featureStates);
  const logo = brand.logoPath ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl(db, brand.logoPath)} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />
  ) : null;
  const mark = logo ?? (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-foreground text-sm font-semibold text-background"
    >
      {organization.name.charAt(0).toUpperCase()}
    </span>
  );
  const inSetup = organization.operationalState === 'setup';
  const organizations = myOrganizations.map((org) => ({ id: org.id, name: org.name, role: org.role }));

  return (
    <div data-brand className="min-h-full">
      <BrandStyle brand={brand} />
      <WorkspaceShell
        sidebar={
          <OrgSidebar
            organizationId={organization.id}
            mark={mark}
            name={organization.name}
            role={organization.role}
            organizations={organizations}
            platformStaff
            isGoldInternal
            enabledModules={[...enabledModules]}
            featureAvailability={[...featureAvailability]}
            capabilities={organization.capabilities}
            setupEntry={inSetup ? <SetupEntry organizationId={organization.id} /> : null}
            email={email}
            signOutAction={signOutAction}
          />
        }
        header={
          <WorkspaceHeader
            navigationTrigger="md"
            context={
              <div className="md:hidden">
                <CompactContextSwitcher
                  mark={mark}
                  current={{
                    kind: 'business',
                    organizationId: organization.id,
                    name: organization.name,
                    role: organization.role,
                  }}
                  organizations={organizations}
                />
              </div>
            }
            primary={<PlatformTrail />}
            status={inSetup ? <SetupBadge organizationId={organization.id} /> : null}
            beforeActions={
              <div className="md:hidden">
                <CompactAccountMenu email={email} signOutAction={signOutAction} />
              </div>
            }
          />
        }
        bottomBar={
          <OrgNavBar
            organizationId={organization.id}
            enabledModules={[...enabledModules]}
            featureAvailability={[...featureAvailability]}
            capabilities={organization.capabilities}
            platformStaff
            isGoldInternal
          />
        }
        agent={<PlatformAgentRail canAnswer={canAnswerAgent} />}
      >
        {children}
      </WorkspaceShell>
    </div>
  );
}
