import OrganizationLoading from './loading';
import { LocationHeading, PageLocationRecords } from '@/components/navigation/workspace-crumbs';
import type { RecordLabel } from '@/lib/route/page-location';

/**
 * The loading state of a route whose location the resolver owns (ADR-047): the bar keeps the known
 * location, the page keeps its one heading, and a record still loading says so rather than naming
 * the record last viewed. On a route that still publishes its own identity, `LocationHeading`
 * renders nothing and this is the organization's ordinary loading state.
 */
export function LocationLoading({ records }: { records?: Readonly<Record<string, RecordLabel>> }) {
  return (
    <>
      {records ? <PageLocationRecords records={records} /> : null}
      <LocationHeading />
      <OrganizationLoading />
    </>
  );
}
