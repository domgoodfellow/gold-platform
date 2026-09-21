import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { AccountAgentRail } from '@/features/account/account-agent-rail';
import { PersonalSettingsSidebar } from '@/features/account/personal-settings-sidebar';
import { SettingsPageFrame } from '@/features/settings/settings-page-frame';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { organizationHomeHref } from '@/lib/navigation';
import { loadPersonContext } from '@/lib/route/person-context';

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
  const { email, hasPassword, organizations: myOrganizations } = await loadPersonContext();
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
