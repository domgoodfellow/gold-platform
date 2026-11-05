import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState } from '@/components/surfaces/section';
import { requireOrganization } from '@/lib/route/organization';
import { currentConfigurationProposal } from '@/lib/domain/configuration/proposals';
import { organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import { ProposalReview } from '@/features/setup/proposal-review';

export const dynamic = 'force-dynamic';

export default async function ConfigurationProposalPage({ params }: PageProps<'/organizations/[organizationId]/setup/proposal'>) {
  const { organizationId } = await params;
  const { db } = await requireOrganization(organizationId);
  const [proposal, features, modules, products] = await Promise.all([
    currentConfigurationProposal(db, { organizationId }), listCatalogFeatures(db), listCatalogModules(db), listCatalogProducts(db),
  ]);
  const states = await organizationResolvedFeatureStates(db, { organizationId }, { features, modules, products });
  return <AppPage>
    <PageHeader title="Review proposed configuration" crumbs={[{ label: 'Organization setup', href: `/organizations/${organizationId}/setup` }]} />
    {proposal ? <ProposalReview organizationId={organizationId} proposal={proposal} featureStates={states} features={features} />
      : <EmptyState>No configuration proposal is waiting to be reviewed.</EmptyState>}
  </AppPage>;
}
