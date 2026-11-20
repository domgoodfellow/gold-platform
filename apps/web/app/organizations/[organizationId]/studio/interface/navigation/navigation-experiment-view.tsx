'use client';

import { OrgNav } from '@/app/organizations/[organizationId]/org-shell';
import { NavigationExperiment } from '@/features/studio/interface/navigation-experiment';
import type { NavigationLayout } from '@/lib/interface-design';

/** The route hands the experiment the shell's own renderer, so the preview is the sidebar itself. */
export function NavigationExperimentView({ organizationId, applied }: { organizationId: string; applied: NavigationLayout }) {
  return <NavigationExperiment Navigation={OrgNav} organizationId={organizationId} applied={applied} />;
}
