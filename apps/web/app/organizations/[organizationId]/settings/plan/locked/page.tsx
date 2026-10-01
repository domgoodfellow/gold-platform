import { redirect } from 'next/navigation';
import { StatePage } from '@/components/patterns/state';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { describeServiceAccess } from '@/lib/domain/platform-billing/service-access';
import { organizationHomeHref } from '@/lib/navigation';
import { requireOrganizationForBillingRecovery } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * Where a business lands when its GOLD subscription does not currently include service. It is
 * the billing-recovery guard's own page: guarding it with `requireOrganization` would send a
 * locked business to a page that sends it here. A business that is not locked has nothing to
 * read on this screen and is sent home, which is also how access returns once a subscription is
 * serviceable — no cache to clear, since the state is read live.
 *
 * The State/Exception pattern: a paused subscription is not an ordinary configuration screen.
 */
export default async function ServiceLockedPage({
  params,
}: PageProps<'/organizations/[organizationId]/settings/plan/locked'>) {
  const { organizationId } = await params;
  const { organization, access } = await requireOrganizationForBillingRecovery(organizationId);
  if (access.permitted) redirect(organizationHomeHref(organizationId, organization.operationalState));

  const canManageBilling = organization.capabilities.includes('billing.manage');

  return (
    <StatePage
      title="Your workspace is paused"
      description="This business’s GildOps subscription does not currently include service, so its workspaces are closed. Nothing has been deleted or changed — everything is exactly as you left it and returns when the subscription is active again."
      action={<ButtonLink href={`/organizations/${organizationId}/settings/plan`}>Go to Plan &amp; usage</ButtonLink>}
      notes={
        <>
          <Hint>{describeServiceAccess(access)}</Hint>
          {canManageBilling ? null : <Hint>Only this business’s billing manager can restore the subscription.</Hint>}
        </>
      }
    />
  );
}
