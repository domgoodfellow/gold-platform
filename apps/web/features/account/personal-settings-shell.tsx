import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { AccountAgentRail } from '@/features/account/account-agent-rail';
import { PersonalSettingsSidebar } from '@/features/account/personal-settings-sidebar';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { findGoldInternalOrganization } from '@/lib/domain/tenancy/gold-internal';
import { platformAdministrationAvailable } from '@/lib/route/platform-context';
import { organizationHomeHref } from '@/lib/navigation';

/**
 * The frame both Personal settings pages render inside. Each page calls this itself rather than
 * leaning on a layout, for the reason every organization page calls `requireOrganization` (I12);
 * it hands back what a section needs to render and takes the section as children.
 *
 * Personal settings is the signed-in person's own identity — it shares the shell and the Settings
 * frame every context uses, and owns nothing an organization does.
 */
export async function PersonalSettingsShell({
  returnOrganizationId,
  children,
}: {
  /** The `?org=` hint. Honoured only if the caller is genuinely a member of that business. */
  returnOrganizationId?: string;
  children: (person: { email: string; hasPassword: boolean }) => ReactNode;
}) {
  const db = await getDb();

  let email: string;
  let hasPassword: boolean;
  try {
    await requireActor(db);
    const { data } = await db.auth.getUser();
    email = data.user?.email ?? '';
    // Supabase records how somebody actually signed in as a list of identities. A Google-only
    // account has no password to change, and offering the form anyway would be a control with
    // nothing behind it (D31's reasoning, restated for auth rather than a module switch).
    hasPassword = (data.user?.identities ?? []).some((identity) => identity.provider === 'email');
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') {
      redirect('/login');
    }
    throw error;
  }

  const myOrganizations = await listMyOrganizations(db);
  const [staff, goldInternal] = await Promise.all([isPlatformStaff(db), findGoldInternalOrganization(db, myOrganizations)]);
  const origin = returnOrganizationId
    ? myOrganizations.find((organization) => organization.id === returnOrganizationId)
    : undefined;

  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/login');
  }

  const sidebar = (
    <PersonalSettingsSidebar
      email={email}
      signOutAction={signOutAction}
      platformAdministration={platformAdministrationAvailable({ staff, goldInternal })}
      businesses={myOrganizations.map((org) => ({
        id: org.id,
        name: org.name,
        role: org.role,
        operationalState: org.operationalState,
      }))}
      back={
        origin
          ? {
              organizationId: origin.id,
              name: origin.name,
              href: organizationHomeHref(origin.id, origin.operationalState),
            }
          : null
      }
    />
  );

  return (
    <WorkspaceShell sidebar={sidebar} header={<WorkspaceHeader navigationTrigger="always" />} agent={<AccountAgentRail />}>
      <SettingsPageFrame>{children({ email, hasPassword })}</SettingsPageFrame>
    </WorkspaceShell>
  );
}
