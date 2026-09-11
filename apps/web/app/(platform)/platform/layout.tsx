import { redirect } from 'next/navigation';
import { AccountMenu } from '@/components/containers/account-menu';
import { AppShell, SHELL_HEADER_HEIGHT, SHELL_HEADER_STYLE, SidebarLabel, SidebarToggle } from '@/components/containers/app-shell';
import { PlatformMobileNavigation } from '@/features/platform/platform-mobile-navigation';
import { PlatformNavigation } from '@/features/platform/platform-navigation';
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

  const sidebar = (
    <>
      <div style={SHELL_HEADER_STYLE} className={`${SHELL_HEADER_HEIGHT} flex items-center gap-2 border-b border-border px-2`}>
        <SidebarToggle />
        <SidebarLabel><span className="font-semibold">GOLD Platform</span></SidebarLabel>
      </div>
      <PlatformNavigation />
    </>
  );

  return (
    <AppShell
      footerCollapse={false}
      header={<><PlatformMobileNavigation /><span className="font-semibold">Platform</span><span className="flex-1" /></>}
      sidebar={sidebar}
      sidebarFooter={<AccountMenu signOutAction={signOutAction} />}
    >
      {children}
    </AppShell>
  );
}
