import { redirect } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { AccountAgentRail } from '@/features/account/account-agent-rail';
import { AccountSettings } from '@/features/account/account-settings';
import { AccountSidebar } from '@/features/account/account-sidebar';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { changePasswordAction } from './actions';

export const dynamic = 'force-dynamic';

/**
 * Personal Settings: identity and security for the signed-in person, independent of which
 * business or Platform context they are currently operating in (D45) — this page belongs to
 * neither. It shares the one authenticated shell every context uses (`WorkspaceShell`) instead of
 * rendering as a standalone island outside it; `ContextSwitcher`, in its own sidebar, remains the
 * one way to move from here into a business workspace.
 */
export default async function AccountPage() {
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

  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/login');
  }

  const sidebar = (
    <AccountSidebar
      email={email}
      signOutAction={signOutAction}
      businesses={myOrganizations.map((org) => ({
        id: org.id,
        name: org.name,
        role: org.role,
        operationalState: org.operationalState,
      }))}
    />
  );

  const header = (
    <WorkspaceHeader navigationTrigger="always" />
  );

  return (
    <WorkspaceShell sidebar={sidebar} header={header} agent={<AccountAgentRail />}>
      <AppPage width="reading">
        <PageHeader title="Account" />
        <AccountSettings email={email} hasPassword={hasPassword} changePasswordAction={changePasswordAction} />
      </AppPage>
    </WorkspaceShell>
  );
}
