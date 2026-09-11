import { AppShell, SHELL_HEADER_HEIGHT, SidebarToggle } from '@/components/containers/app-shell';
import { AccountMenu } from '@/components/containers/account-menu';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { redirect } from 'next/navigation';
import { PlatformNavigation } from '@/features/platform/platform-navigation';

export default function PlatformLayout({ children }: LayoutProps<'/platform'>) {
  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/login');
  }

  const sidebar = <><div className={`${SHELL_HEADER_HEIGHT} flex items-center border-b border-border px-2`}><SidebarToggle /><span className="ml-2 hidden text-sm font-semibold lg:block">GOLD Platform</span></div><PlatformNavigation /></>;
  return <AppShell footerCollapse={false} header={<><span className="font-semibold">Platform</span><span className="flex-1" /></>} sidebar={sidebar} sidebarFooter={<AccountMenu signOutAction={signOutAction} />}>{children}</AppShell>;
}
