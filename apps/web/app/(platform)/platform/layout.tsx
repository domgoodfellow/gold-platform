import { redirect } from 'next/navigation';
import { PlatformShell } from '@/features/platform/platform-shell';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { signOut } from '@/lib/domain/identity/credentials';
import { isPlatformStaff } from '@/lib/domain/platform/tenants';
import { requireActor } from '@/lib/domain/tenancy/actor';

export default async function PlatformLayout({ children }: LayoutProps<'/platform'>) {
  const db = await getDb();
  try {
    await requireActor(db);
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
    <PlatformShell signOutAction={signOutAction}>
      {children}
    </PlatformShell>
  );
}
