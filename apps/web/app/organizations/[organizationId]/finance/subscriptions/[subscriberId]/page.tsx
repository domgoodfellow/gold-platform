import { notFound } from 'next/navigation';
import { SubscriptionRecord } from '@/features/finance/subscriptions/subscription-record';
import { loadSubscription } from '@/lib/application/finance/subscriptions';
import { loadOrganizationEconomics } from '@/lib/application/finance/cost-to-serve';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { platformHref } from '@/lib/platform-navigation';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * One business's subscription in GildOps' Finance. Changing it takes `subscription.manage`; its
 * economics are drawn only for `cost.read`. The links to the same business elsewhere are offered
 * only to members who may open them: the CRM customer with `customer.read`, its Administration
 * record with the platform permission over organizations.
 */
export default async function SubscriptionPage({ params }: PageProps<'/organizations/[organizationId]/finance/subscriptions/[subscriberId]'>) {
  const { organizationId, subscriberId } = await params;
  const { db, organization, gate } = await requireOperatingArea(organizationId, 'finance-subscriptions');
  const has = (capability: (typeof organization.capabilities)[number]) => organization.capabilities.includes(capability);
  const mayReadCosts = has('cost.read') && gate.featureAvailability.has('cost_to_serve');
  const [model, economics, platform] = await Promise.all([
    loadSubscription(db, { sellerId: organizationId, subscriberId }),
    mayReadCosts ? loadOrganizationEconomics(db, { organizationId: subscriberId }) : Promise.resolve(null),
    loadPlatformContext(db, organizationId),
  ]);
  if (!model) notFound();
  return (
    <SubscriptionRecord
      organizationId={organizationId}
      subscriberId={subscriberId}
      model={model}
      mayManage={has('subscription.manage')}
      economics={economics}
      links={{
        customer: model.customerId && has('customer.read') ? `/organizations/${organizationId}/crm/contacts/${model.customerId}` : undefined,
        administration: platform?.permissions.has('platform.organizations') ? platformHref(organizationId, `organizations/${subscriberId}`) : undefined,
      }}
    />
  );
}
