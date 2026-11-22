'use server';

import { readSetupStatus, type SetupStatus } from '@/lib/application/setup/status';
import { requireOrganization } from '@/lib/route/organization';

/** The header's setup status, read again each time it opens; membership is proved before any read. */
export async function setupStatusAction(organizationId: string): Promise<SetupStatus> {
  const { db, organization } = await requireOrganization(organizationId);
  return readSetupStatus(db, organization);
}
