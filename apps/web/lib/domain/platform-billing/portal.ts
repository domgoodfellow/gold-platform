import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * Opening the billing portal. `begin_platform_billing_portal_session` checks `billing.manage`
 * and resolves the organization's own customer reference server-side (Phase 8: never a
 * client-supplied id) — this function never reads `platform_billing_customers` directly.
 */
export async function beginPlatformBillingPortalSession(
  db: Db,
  input: { organizationId: string; returnUrl: string },
): Promise<{ url: string } | null> {
  const provider = await platformBillingProvider();
  if (!provider) return null;

  const { data: customerReference, error } = await db.rpc('begin_platform_billing_portal_session', {
    p_organization_id: input.organizationId,
    p_environment: provider.environment,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'Only this business’s own billing manager can open billing.',
        'platform_billing.forbidden',
      );
    }
    throw fromDatabaseError(error, 'platform_billing.portal_failed');
  }

  // No customer yet — nothing to manage. The screen simply shows no control, the same shape
  // an unconfigured processor already gives.
  if (!customerReference) return null;

  const started = await provider.createPortalSession({
    customerId: customerReference,
    returnUrl: input.returnUrl,
  });

  return { url: started.url };
}
