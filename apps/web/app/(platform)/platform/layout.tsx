import { redirect } from 'next/navigation';
import { PlatformShell } from '@/features/platform/platform-shell';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { listMyOrganizations } from '@/lib/domain/tenancy/organizations';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { canAnswerPlatformQuestions } from '@/lib/domain/assistant/platform-questions';

export default async function PlatformLayout({ children }: LayoutProps<'/platform'>) {
  const db = await getDb();
  let email: string;
  try {
    const actor = await requireActor(db);
    // `requireActor` proves a session exists but returns only an id (I11's minimal shape);
    // the email the shell shows is a second, deliberately separate read of the same session.
    const { data } = await db.auth.getUser();
    email = data.user?.email ?? actor.id;
  } catch (error) {
    if (error instanceof DomainError && error.code === 'auth.required') redirect('/login');
    throw error;
  }
  if (!(await isPlatformStaff(db))) redirect('/organizations');

  // The same read the organization shell already makes for its own switcher (D45: one identity,
  // both facts, at once) — so a staff member who also belongs to one or more businesses can move
  // to any of them from here without a detour through /account or /organizations.
  const [businesses, canAnswerAgent] = await Promise.all([
    listMyOrganizations(db),
    canAnswerPlatformQuestions(),
  ]);

  async function signOutAction() {
    'use server';
    const actionDb = await getDb();
    await signOut(actionDb);
    redirect('/login');
  }

  return (
    <PlatformShell
      email={email}
      signOutAction={signOutAction}
      businesses={businesses.map((organization) => ({
        id: organization.id,
        name: organization.name,
        role: organization.role,
      }))}
      canAnswerAgent={canAnswerAgent}
    >
      {children}
    </PlatformShell>
  );
}
