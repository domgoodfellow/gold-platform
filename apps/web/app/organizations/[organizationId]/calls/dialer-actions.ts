'use server';

import { callingSetupDoor, loadCallingOptions, type CallingOptions } from '@/lib/application/communications/calling-options';
import { workspaceConfigureDoors } from '@/features/settings/workspace-configure';
import { requireOrganization } from '@/lib/route/organization';
import { DomainError } from '@/lib/domain/errors';

/** Calling options as the server resolves them now, with where a blocker is fixed when the viewer may open it. */
export type DialerOptions = CallingOptions & { setup: { href: string; label: string } | null };

/**
 * What this person can call from right now. The pop-out window opened from the dock asks this, and
 * the Dialer asks it again after the server refuses a call, so neither keeps offering a number
 * whose assignment or sharing has since changed.
 */
export async function loadDialerAction(organizationId: string): Promise<DialerOptions> {
  try {
    const { db, organization } = await requireOrganization(organizationId);
    const options = await loadCallingOptions(db, { organizationId, mayCall: organization.capabilities.includes('call.place') });
    const setup = options.blocker?.setup ? callingSetupDoor(options.blocker, await workspaceConfigureDoors(organizationId, 'communications')) : null;
    return { ...options, setup };
  } catch (error) {
    if (error instanceof DomainError) return { numbers: [], defaultNumber: null, unavailableReason: error.message, blocker: { kind: 'unavailable', code: 'service-unavailable', reason: error.message, setup: null }, setup: null };
    throw error;
  }
}
