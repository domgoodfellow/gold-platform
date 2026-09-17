import { redirect } from 'next/navigation';
import { Card } from '@/components/containers/card';
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
import { bootstrapGoldInternalWorkspace, findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import {
  OrgNavBar,
  OrgSidebar,
  PlatformTrail,
  SetupBadge,
  SetupEntry,
} from '@/app/organizations/[organizationId]/org-shell';
import { GoldBootstrapForm, type BootstrapState } from './gold-bootstrap-form';

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

  async function bootstrapAction(_state: BootstrapState, formData: FormData): Promise<BootstrapState> {
    'use server';
    const actionDb = await getDb();
    const organizationId = String(formData.get('organizationId') ?? '').trim();
    try {
      await bootstrapGoldInternalWorkspace(actionDb, { organizationId });
    } catch (error) {
      if (error instanceof DomainError) return { error: error.message };
      throw error;
    }
    redirect('/platform');
  }

  if (!goldInternal) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <Card className="w-full max-w-lg space-y-4">
          <div className="space-y-2">
            <h1 className="text-lg font-semibold">GOLD operating workspace must be initialized.</h1>
            <p className="text-sm text-muted">
              Platform authority is present, but this account does not yet have a real membership
              in the canonical GOLD Internal organization.
            </p>
          </div>
          <GoldBootstrapForm action={bootstrapAction} />
        </Card>
      </main>
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
                  platformStaff
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
