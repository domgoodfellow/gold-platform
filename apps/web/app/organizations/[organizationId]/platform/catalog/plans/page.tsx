import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import Link from 'next/link';
import { AppPage } from '@/components/containers/app-page';
import { SectionHeading } from '@/components/containers/section';
import { PageHeader } from '@/components/containers/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@gold/ui/components/card';
import { Badge } from '@/components/display/data';
import { getDb } from '@/lib/db/server';
import { listPlanProductGrants, listPlanQuotas, listPlans, listPlanPrices } from '@/lib/domain/catalogue/plans';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { CreatePlanSheet } from '@/features/platform/catalog/plan-forms';

export const dynamic = 'force-dynamic';

export default async function PlansPage({ params }: PageProps<'/organizations/[organizationId]/platform/catalog/plans'>) {
  const { organizationId: goldId } = await params;
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const plans = await listPlans(db);

  const details = await Promise.all(
    plans.map(async (plan) => {
      const [products, quotas, prices] = await Promise.all([
        listPlanProductGrants(db, plan.id),
        listPlanQuotas(db, plan.id),
        listPlanPrices(db, plan.id),
      ]);
      const currentPrice = prices.find((p) => p.approvalState === 'approved');
      return { plan, productCount: products.length, quotaCount: quotas.length, currentPrice };
    }),
  );

  const basePlans = details.filter((d) => d.plan.kind === 'plan');
  const addons = details.filter((d) => d.plan.kind === 'addon');

  return (
    <AppPage>
      <PageHeader title="Plans & Add-ons" actions={<CreatePlanSheet />} description="Reusable packaging over the canonical catalogue. A Plan is one organization&rsquo;s base package; an Add-on stacks alongside it." />

      <SectionHeading>Plans</SectionHeading>
      {basePlans.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No Plans have been created yet.</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {basePlans.map((d) => (
            <PlanCard goldId={goldId} key={d.plan.id} {...d} />
          ))}
        </div>
      )}

      <SectionHeading className="mt-8">Add-ons</SectionHeading>
      {addons.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">No Add-ons yet.</p>
      ) : (
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {addons.map((d) => (
            <PlanCard goldId={goldId} key={d.plan.id} {...d} />
          ))}
        </div>
      )}
    </AppPage>
  );
}

function PlanCard({
  goldId,
  plan,
  productCount,
  quotaCount,
  currentPrice,
}: {
  goldId: string;
  plan: { id: string; key: string; label: string; description: string; billable: boolean; saleStatus: string };
  productCount: number;
  quotaCount: number;
  currentPrice?: { amountMinor: number; currency: string; billingInterval: string };
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{plan.label}</CardTitle>
          {!plan.billable ? <Badge>Non-billable</Badge> : null}
        </div>
        <CardDescription>{plan.description || 'No description yet.'}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <p>
          {currentPrice
            ? `${formatMoney(currentPrice.amountMinor, currentPrice.currency)} / ${currentPrice.billingInterval.replace('_', ' ')}`
            : 'No standard price recorded'}
        </p>
        <p className="text-muted-foreground">
          {productCount} Product{productCount === 1 ? '' : 's'} · {quotaCount} quota definition{quotaCount === 1 ? '' : 's'}
        </p>
        {plan.saleStatus !== 'active' ? <Badge>{plan.saleStatus}</Badge> : null}
        <Link href={platformHref(goldId, `catalog/plans/${plan.key}`)} className="mt-1 font-medium underline underline-offset-4">
          Open
        </Link>
      </CardContent>
    </Card>
  );
}
