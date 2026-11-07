import type { ReactNode } from 'react';
import { requirePlatformScope } from '@/lib/route/platform';
import { readShellLayout } from '@/lib/route/shell-layout';
import { ShellLayoutProvider } from '@/components/layout/shell-layout-context';
import { PlatformShell } from '@/features/platform/platform-shell';
import { AccountAppearance } from '@/features/appearance/account-appearance';
export default async function PlatformLayout({children}:{children:ReactNode}) {
 const {organization,permissions}=await requirePlatformScope();
 return <AccountAppearance><ShellLayoutProvider value={await readShellLayout()}><PlatformShell organizationId={organization.id} permissions={[...permissions]}>{children}</PlatformShell></ShellLayoutProvider></AccountAppearance>;
}
