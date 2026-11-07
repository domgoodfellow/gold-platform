import { AppPage } from '@/components/layout/app-page';
import { PageHeader } from '@/components/headers/page-header';
import { EmptyState } from '@/components/surfaces/section';
import { requireOrganization } from '@/lib/route/organization';
import {
  currentConfigurationProposal,
  listCopySources,
  listIndustryTemplates,
  suggestedTemplateKey,
  type ConfigurationProposal,
} from '@/lib/domain/configuration/proposals';
import { withWorkTypes } from '@/lib/domain/configuration/shape';
import { organizationResolvedFeatureStates } from '@/lib/domain/catalogue/organization-plans';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts } from '@/lib/domain/catalogue/catalogue';
import { getOrganizationIdentity } from '@/lib/domain/tenancy/identity';
import { ProposalReview, StartingPointChooser } from '@/features/setup/proposal-review';

export const dynamic = 'force-dynamic';

/** Where a draft came from, in a few plain words, so an owner knows whose suggestion they are reading. */
function provenance(proposal: ConfigurationProposal): string | undefined {
  if (proposal.origin === 'agreed') return `Agreed with GildOps: ${proposal.description}`;
  if (proposal.origin === 'provisioned') return `Prepared by GildOps: ${proposal.description}`;
  if (proposal.origin === 'template') return `Starting from ${proposal.description}`;
  if (proposal.origin === 'copied') return `Copied from ${proposal.description}`;
  return undefined;
}

/**
 * The one place a setup document is reviewed and applied: a drafted proposal, a starting template
 * the owner chose, or one GildOps prepared or agreed. With nothing waiting, a business still being
 * set up is offered its starting points here.
 */
export default async function ConfigurationProposalPage({ params }: PageProps<'/organizations/[organizationId]/setup/proposal'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);
  const crumbs = [{ label: 'Organization setup', href: `/organizations/${organizationId}/setup` }];
  const proposal = await currentConfigurationProposal(db, { organizationId });

  if (!proposal) {
    const offer = organization.operationalState === 'setup' && organization.capabilities.includes('configuration.propose');
    if (!offer) {
      return <AppPage>
        <PageHeader title="Review proposed configuration" crumbs={crumbs} />
        <EmptyState>No configuration proposal is waiting to be reviewed.</EmptyState>
      </AppPage>;
    }
    const [templates, identity, businesses] = await Promise.all([
      listIndustryTemplates(db), getOrganizationIdentity(db, organizationId), listCopySources(db, { organizationId }),
    ]);
    return <AppPage>
      <PageHeader title="Choose a starting point" crumbs={crumbs} />
      <StartingPointChooser organizationId={organizationId} templates={templates} businesses={businesses} suggested={suggestedTemplateKey(templates, identity.industry)} />
    </AppPage>;
  }

  const [features, modules, products] = await Promise.all([listCatalogFeatures(db), listCatalogModules(db), listCatalogProducts(db)]);
  const states = await organizationResolvedFeatureStates(db, { organizationId }, { features, modules, products });
  const starting = proposal.origin !== 'drafted';
  return <AppPage>
    <PageHeader title={starting ? 'Review your starting setup' : 'Review proposed configuration'} crumbs={crumbs} meta={provenance(proposal)} />
    {/* Edited in the several-kinds-of-work form whichever form it was stored in. */}
    <ProposalReview organizationId={organizationId} proposal={{ ...proposal, shape: withWorkTypes(proposal.shape) }} featureStates={states} features={features} />
  </AppPage>;
}
