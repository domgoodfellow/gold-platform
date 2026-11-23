import { notFound } from 'next/navigation';
import { SubscriptionRecord } from '@/features/finance/subscriptions/subscription-record';
import { loadSubscription } from '@/lib/application/finance/subscriptions';
import { loadOrganizationEconomics } from '@/lib/application/finance/cost-to-serve';
import { loadPlatformContext } from '@/lib/application/shell/platform-context';
import { todayIso } from '@/lib/domain/subscriptions/subscriptions';
import { platformHref } from '@/lib/platform-navigation';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

export const dynamic = 'force-dynamic';

/**
 * One subscription in Finance. Changing it takes `subscription.manage`, invoicing a period
 * `invoice.issue`. Where it provisions a business, its economics are drawn only for `cost.read`,
 * and the links to the same customer and business elsewhere only for members who may open them:
 * the CRM customer with `customer.read`, its Administration record with the platform permission
 * over organizations.
 */
export default async function SubscriptionPage({ params }: PageProps<'/organizations/[organizationId]/finance/subscriptions/[subscriptionId]'>) {
  const { organizationId, subscriptionId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(subscriptionId)) notFound();
  const { db, organization, gate } = await requireOperatingArea(organizationId, 'finance-subscriptions');
  const has = (capability: (typeof organization.capabilities)[number]) => organization.capabilities.includes(capability);
  const model = await loadSubscription(db, { organizationId, subscriptionId });
  if (!model) notFound();
  const mayReadCosts = has('cost.read') && gate.featureAvailability.has('cost_to_serve');
  const [economics, platform] = await Promise.all([
    model.platform && mayReadCosts ? loadOrganizationEconomics(db, { organizationId: model.platform.tenant.id }) : Promise.resolve(null),
    model.platform ? loadPlatformContext(db, organizationId) : Promise.resolve(null),
  ]);
  return (
    <SubscriptionRecord
      organizationId={organizationId}
      model={model}
      may={{ manage: has('subscription.manage'), issue: has('invoice.issue') }}
      economics={economics}
      today={todayIso()}
      links={{
        customer: has('customer.read') ? `/organizations/${organizationId}/crm/contacts/${model.customer.id}` : undefined,
        administration: model.platform && platform?.permissions.has('platform.organizations') ? platformHref(organizationId, `organizations/${model.platform.tenant.id}`) : undefined,
      }}
    />
  );
}
