import { LocationLoading } from '../../../location-loading';

/** A customer is loading: CRM › Customers › Loading…, never the customer last viewed (ADR-047). */
export default function CustomerLoading() {
  return <LocationLoading records={{ contactId: { state: 'loading' } }} />;
}
