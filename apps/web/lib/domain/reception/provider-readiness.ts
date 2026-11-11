import type { Db } from '@/lib/db/types';
import { telephonyProviderKey } from '@/lib/adapters/telephony';
import { getProviderBinding, type ProviderBinding } from '@/lib/domain/providers/bindings';

export type CommunicationsReadiness = 'ready' | 'not_ready' | 'provisioning' | 'error';

/**
 * What Communications may truthfully say about its own calling infrastructure — never the scope
 * itself: no subaccount id, no credential, nothing a carrier would recognise, only this one
 * word. Presentation vocabulary over the one binding read every other caller of
 * `organization_provider_bindings` already uses (`getProviderBinding`) — not a second calculation
 * of readiness; `lib/domain/providers/status.ts`'s `providerReadiness` is the platform's own
 * reading of the same fact, for the same reason.
 *
 * **A business with no binding at all reads `ready` here, and that is not a promise it can call.**
 * This word reports faults in a calling account that exists. Whether a business has one at all is
 * asked separately and first (`callingRuntimeConfigured`, `organizationTelephony` in `calls.ts`):
 * calls happen only in a business's own calling account, and there is no shared one to fall back
 * to. Text messaging still sends through the deployment's own account, which is why an absent
 * binding is not a fault for that channel.
 */
export function readinessFromBindingStatus(status: ProviderBinding['status'] | null): CommunicationsReadiness {
  switch (status) {
    case null:
    case 'active':
      return 'ready';
    case 'provisioning':
      return 'provisioning';
    case 'failed':
      return 'error';
    case 'suspended':
      return 'not_ready';
  }
}

export async function communicationsProviderReadiness(
  db: Db,
  input: { organizationId: string },
): Promise<CommunicationsReadiness> {
  const binding = await getProviderBinding(db, {
    organizationId: input.organizationId,
    providerKey: telephonyProviderKey(),
  });
  return readinessFromBindingStatus(binding?.status ?? null);
}
