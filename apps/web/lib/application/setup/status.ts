import type { Db } from '@/lib/db/types';
import { computeSetupOverview } from '@/lib/domain/tenancy/lifecycle';

/**
 * The organization header's setup status, read from `computeSetupOverview` only while the business
 * is in SETUP. Required blockers are the only steps counted, so recommended and optional areas never
 * read as "not ready to launch". Launch authority (`organization.manage`) only chooses the wording;
 * the Setup page and `launchOrganization` still enforce it.
 */
export type SetupStatus =
  | { state: 'live' }
  | { state: 'unavailable'; mayLaunch: boolean }
  | { state: 'open'; mayLaunch: boolean; ready: number; total: number; required: { key: string; label: string; message: string }[] };

export async function readSetupStatus(
  db: Db,
  organization: { id: string; operationalState: string; capabilities: readonly string[] },
): Promise<SetupStatus> {
  if (organization.operationalState !== 'setup') return { state: 'live' };
  const mayLaunch = organization.capabilities.includes('organization.manage');
  try {
    const overview = await computeSetupOverview(db, { organizationId: organization.id });
    return {
      state: 'open', mayLaunch, ready: overview.ready, total: overview.total,
      required: overview.blockers.map(area => ({ key: area.key, label: area.label, message: area.message })),
    };
  } catch {
    return { state: 'unavailable', mayLaunch };
  }
}
