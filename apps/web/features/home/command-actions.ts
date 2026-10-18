'use server';

import { requireOrganization } from '@/lib/route/organization';
import { loadHome } from '@/lib/application/home/load';

/** Read under the current actor on every request, including outside Home. */
export async function loadCommandData(organizationId: string) {
  const { db, organization } = await requireOrganization(organizationId);
  return loadHome(db, organization);
}
