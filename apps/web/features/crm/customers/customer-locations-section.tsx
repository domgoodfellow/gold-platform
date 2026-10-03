import Link from 'next/link';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/surfaces/section';
import type { Location } from '@/lib/domain/locations/locations';
import { CustomerLocationMapLoader } from './customer-location-map-loader';

/**
 * A Customer's own sites — CRM viewing the Location domain through the customer relationship,
 * never owning it. The record list here, and the generic map underneath it, both read exactly
 * the `customer_locations` linkage the canonical Locations workspace reads; adding or unlinking a
 * site stays there, reached through "View all".
 */
export function CustomerLocationsSection({
  organizationId,
  customerId,
  locations,
  mapStyleUrl,
}: {
  organizationId: string;
  customerId: string;
  locations: Location[];
  mapStyleUrl: string | null;
}) {
  const locationsHref = `/organizations/${organizationId}/locations?customer=${customerId}`;

  if (locations.length === 0) {
    return (
      <EmptyState>
        No locations are recorded for this customer yet.{' '}
        <Link href={locationsHref} className="underline underline-offset-4">
          Link one from Locations
        </Link>
        .
      </EmptyState>
    );
  }

  return (
    <Section className="border-t-0 pt-0">
      <div className="flex items-center justify-between gap-3">
        <SectionHeading>
          {locations.length} location{locations.length === 1 ? '' : 's'}
        </SectionHeading>
        <Link href={`${locationsHref}&view=map`} className="text-sm underline underline-offset-4">
          View all →
        </Link>
      </div>

      <div className="mt-3">
        <CustomerLocationMapLoader organizationId={organizationId} locations={locations} mapStyleUrl={mapStyleUrl} />
      </div>

      <DividedList className="mt-3">
        {locations.map((location) => (
          <li key={location.id} className="py-2">
            <Link
              href={`/organizations/${organizationId}/locations/${location.id}`}
              className="font-medium underline underline-offset-4"
            >
              {location.label}
            </Link>
            <div className="text-sm text-muted">{location.address}</div>
          </li>
        ))}
      </DividedList>
    </Section>
  );
}
