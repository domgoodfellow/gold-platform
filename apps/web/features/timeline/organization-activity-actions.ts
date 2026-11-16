'use server';

import { requireOrganization } from '@/lib/route/organization';
import { listOrganizationActivity, type OrganizationActivity } from '@/lib/domain/timeline/timeline';

export type ActivityResult = { state: 'ready'; data: OrganizationActivity } | { state: 'unavailable' };

export async function loadOrganizationActivityAction(organizationId: string, limit = 20): Promise<ActivityResult> {
  const { db } = await requireOrganization(organizationId);
  try {
    return { state: 'ready', data: await listOrganizationActivity(db, { organizationId, limit }) };
  } catch {
    return { state: 'unavailable' };
  }
}
