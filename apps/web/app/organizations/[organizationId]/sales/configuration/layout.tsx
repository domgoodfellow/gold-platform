import type { ReactNode } from 'react';
import { requireWorkspaceConfiguration } from '@/lib/route/workspace-configuration';

export default async function ConfigurationLayout({ params, children }: { params: Promise<{ organizationId: string }>; children: ReactNode }) {
  const { organizationId } = await params;
  await requireWorkspaceConfiguration(organizationId, 'crm');
  return children;
}
