import Link from 'next/link';
import { AppShell, SidebarIdentity } from '@/components/containers/app-shell';
import { AccountMenu } from '@/components/containers/account-menu';
import { getDb } from '@/lib/db/server';
import { signOut } from '@/lib/domain/identity/credentials';
import { redirect } from 'next/navigation';

export default function PlatformLayout({ children }: LayoutProps<'/platform'>) {
  async function signOutAction() {
    'use server';
    const db = await getDb();
    await signOut(db);
    redirect('/login');
  }

  const sidebar = <>
    <SidebarIdentity mark={<span aria-hidden className="flex size-7 items-center justify-center rounded bg-foreground text-sm font-semibold text-background">G</span>} label={<span className="hidden lg:block"><span className="block font-semibold">GOLD</span><span className="block text-xs text-muted">Platform</span></span>} />
    <nav aria-label="Platform" className="flex-1 p-3"><ul className="space-y-1"><li><Link href="/platform" className="block rounded px-3 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10">Overview</Link></li></ul></nav>
  </>;
  return <AppShell header={<><span className="font-semibold">Platform</span><span className="flex-1" /></>} sidebar={sidebar} sidebarFooter={<AccountMenu signOutAction={signOutAction} />}>{children}</AppShell>;
}
