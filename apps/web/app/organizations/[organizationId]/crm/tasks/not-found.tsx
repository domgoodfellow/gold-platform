import { OrganizationPageNotFound } from '@/features/account/organization-not-found';
import { PageLocationRecords } from '@/components/navigation/workspace-crumbs';

/** Follow-ups is not available to this business: CRM › Not found, inside CRM (ADR-047). */
export default function FollowUpsNotFound() {
  return (
    <>
      <PageLocationRecords notFound />
      <OrganizationPageNotFound />
    </>
  );
}
