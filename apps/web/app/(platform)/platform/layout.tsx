import { redirect } from 'next/navigation';
import { PlatformShell } from '@/features/platform/platform-shell';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { requireActor } from '@/lib/domain/tenancy/actor';

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

  async function signOutAction() {
    'use server';
    const actionDb = await getDb();
    await signOut(actionDb);
    redirect('/login');
  }

  return (
    <PlatformShell email={email} signOutAction={signOutAction}>
      {children}
    </PlatformShell>
  );
}
