import { LocationLoading } from '../../../location-loading';

/** An opportunity is loading: CRM › Opportunities › Loading…, never the one last viewed (ADR-047). */
export default function OpportunityLoading() {
  return <LocationLoading records={{ opportunityId: { state: 'loading' } }} />;
}
