import { OrganizationPageNotFound } from '@/features/account/organization-not-found';
import { PageLocationRecords } from '@/components/navigation/workspace-crumbs';

/**
 * A customer this person cannot see — missing, deleted or another business's — ends the location
 * at CRM › Customers › Not found. The three cases read the same, so nothing says the record exists.
 */
export default function CustomerNotFound() {
  return (
    <>
      <PageLocationRecords records={{ contactId: { state: 'missing' } }} />
      <OrganizationPageNotFound />
    </>
  );
}
