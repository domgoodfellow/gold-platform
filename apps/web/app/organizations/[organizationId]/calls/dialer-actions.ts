'use server';

import { loadCallingOptions, type CallingOptions } from '@/lib/application/communications/calling-options';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';

export async function loadDialerAction(organizationId: string): Promise<CallingOptions> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    return await loadCallingOptions(db, { organizationId, mayCall: organization.capabilities.includes('call.place') });
  } catch (error) {
    if (error instanceof DomainError) return { numbers: [], defaultNumber: null, unavailableReason: error.message };
    throw error;
  }
}
