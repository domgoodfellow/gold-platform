import type { Db } from '@/lib/db/types';
import { organizationTelephony } from '@/lib/domain/reception/calls';

/**
 * Whether this business can place a call at all: it has an active calling account of its own, and
 * this deployment can reach the runtime that places calls. Screens ask this rather than importing
 * the adapter.
 */
export async function callingRuntimeConfigured(db: Db, input: { organizationId: string; mayCall: boolean }): Promise<boolean> {
  return input.mayCall && !!(await organizationTelephony(db, input.organizationId));
}
