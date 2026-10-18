import type { ReactNode } from 'react';
import { requirePlatformScope } from '@/lib/route/platform';
import { PlatformShell } from '@/features/platform/platform-shell';
export default async function PlatformLayout({children}:{children:ReactNode}) {
 const {organization,permissions}=await requirePlatformScope();
 return <PlatformShell organizationId={organization.id} permissions={[...permissions]}>{children}</PlatformShell>;
}
