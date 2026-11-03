import type { Db } from '@/lib/db/types';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { areaAvailable } from '@/lib/navigation';

/**
 * Whether this person can open the Communications Inbox here — the predicate navigation and Home
 * use, asked by another workspace that wants to link to a conversation without offering a link
 * that would only reach "not found".
 */
export async function inboxAvailable(db: Db, input: { organizationId: string; capabilities: readonly string[] }): Promise<boolean> {
  const states = await organizationResolvedFeatureStates(db, { organizationId: input.organizationId });
  return areaAvailable('comms-inbox', {
    capabilities: new Set(input.capabilities) as Parameters<typeof areaAvailable>[1]['capabilities'],
    featureAvailability: availableFeatureKeys(states),
    enabled: activeModuleKeys(states),
  });
}
