import { OrganizationPageNotFound } from '@/features/account/organization-not-found';
import { PageLocationRecords } from '@/components/navigation/workspace-crumbs';

/**
 * An opportunity this person cannot see — missing, deleted or another business's — ends the
 * location at CRM › Opportunities › Not found. The cases read the same, so nothing says it exists.
 */
export default function OpportunityNotFound() {
  return (
    <>
      <PageLocationRecords records={{ opportunityId: { state: 'missing' } }} />
      <OrganizationPageNotFound />
    </>
  );
}
