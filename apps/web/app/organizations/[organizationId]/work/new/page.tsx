import { getCommercialProposal } from '@/lib/domain/customers/commercial-proposals';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listUsableModules } from '@/lib/domain/tenancy/modules';
import { notFound } from 'next/navigation';
import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { WorkCreatePage } from '@/features/work/work-create-page';
import { workCreateOptions } from '@/lib/application/work/create-options';
import { requireOrganization } from '@/lib/route/organization';
import { areaAvailable, areaHref, areaLabel } from '@/lib/navigation';
import { activeModuleKeys, availableFeatureKeys, organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';

export const dynamic = 'force-dynamic';

export default async function NewWorkPage({ params, searchParams }: PageProps<'/organizations/[organizationId]/work/new'>) {
  const { organizationId } = await params;
  const { type, service, customer, proposal: proposalId, line, returnTo, setupStep } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);
  if (!organization.capabilities.includes('work_item.create')) notFound();
  const features = await organizationResolvedFeatureStates(db, { organizationId });
  const state = { enabled: activeModuleKeys(features), featureAvailability: availableFeatureKeys(features), capabilities: new Set(organization.capabilities) };
  if (!areaAvailable('work', state)) notFound();
  const options = await workCreateOptions(db, organizationId, areaAvailable('assets', state));
  options.services = organization.capabilities.includes('work_item.price') && (await listUsableModules(db, { organizationId })).has('billing') ? await listPriceBookItems(db, { organizationId }) : [];
  const proposal = typeof proposalId === 'string' ? await getCommercialProposal(db, { organizationId, proposalId }) : null;
  const proposalLine = proposal?.status === 'accepted' && typeof line === 'string' ? proposal.lines.find(entry => entry.position === Number(line)) : undefined;
  if (proposalId && !proposalLine) notFound();
  const delivery = proposal && proposalLine ? { proposalId: proposal.id, position: proposalLine.position, customerId: proposal.customerId, name: proposalLine.name } : undefined;
  // A bounded Form page: one focused creation task, not a fluid workspace surface.
  return <AppPage width="form">
    <PageHeader title="New work" crumbs={[{ label: areaLabel('work'), href: areaHref(organizationId, 'work') }]} />
    <WorkCreatePage options={options} delivery={delivery} initialServiceId={typeof service === 'string' ? service : undefined} initialCustomerId={typeof customer === 'string' ? customer : undefined} initialTypeId={typeof type === 'string' ? type : undefined} mayConfigure={organization.capabilities.includes('field.manage')} returnToQuote={returnTo === 'quote'} setupStep={typeof setupStep === 'string' ? setupStep : undefined} />
  </AppPage>;
}
