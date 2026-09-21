import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { WorkspaceHeader } from '@/components/containers/workspace-header';
import { WorkspaceShell } from '@/components/containers/workspace-shell';
import { AccountAgentRail } from '@/features/account/account-agent-rail';
import { GlobalFallbackSidebar } from '@/features/account/global-fallback-sidebar';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { destinationFor, readLastOrganizationId, resolveOrganizationsLanding } from '@/lib/route/landing';
import { loadPersonContext } from '@/lib/route/person-context';

/** The one recovery a fallback offers: where a sign-in would land this person, named for what it is. */
export type Recovery = { href: string; label: string };

/**
 * The frame for an authenticated failure where *no organization can be trusted* — a business the
 * caller cannot prove membership in. It is built from `loadPersonContext` alone: who the person
 * is and which scopes are genuinely theirs. It never receives, reads or renders the requested
 * organization id, so it cannot name, brand or lay out a business that may not exist for them —
 * the lobby, not Room 412. The sidebar is the context switcher and account menu and nothing else.
 *
 * The recovery is the same validated landing a sign-in uses (`resolveOrganizationsLanding`), not
 * GOLD, not the first business and not Platform by hand. It only reads, so it is safe to run
 * while rendering: `resolvePostAuthDestination` also consumes an invite cookie, which a render
 * may not do.
 */
export async function GlobalFallbackShell({ children }: { children: (recovery: Recovery) => ReactNode }) {
  const person = await loadPersonContext();

  const landing = resolveOrganizationsLanding({
    organizations: person.organizations,
    staff: person.staff,
    preferredOrganizationId: person.goldInternal?.id,
    lastOrganizationId: await readLastOrganizationId(),
  });
  const recovery: Recovery = {
    href: destinationFor(landing),
    label: landing.kind === 'onboarding' ? 'Set up your business' : 'Return to workspace',
  };

  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/login');
  }

  return (
    <WorkspaceShell
      sidebar={
        <GlobalFallbackSidebar
          email={person.email}
          signOutAction={signOutAction}
          businesses={person.organizations.map((org) => ({
            id: org.id,
            name: org.name,
            role: org.role,
            operationalState: org.operationalState,
          }))}
        />
      }
      header={<WorkspaceHeader navigationTrigger="always" />}
      agent={<AccountAgentRail />}
    >
      {children(recovery)}
    </WorkspaceShell>
  );
}
