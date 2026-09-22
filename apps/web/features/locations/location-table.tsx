import Link from 'next/link';
import { DataTable } from '@/components/display/table';
import { CustomFieldValues } from '@/features/custom-fields/values';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { Location } from '@/lib/domain/locations/locations';
import { LocationCoordinatesDrawer } from './location-coordinates-drawer';

/**
 * The Locations collection. Coordinates are derived operational metadata, never a primary
 * column — an editor gets a bounded `LocationCoordinatesDrawer` as the row action; a viewer who
 * cannot edit sees the value plainly, since there is nothing here to trigger.
 */
export function LocationTable({
  organizationId,
  locations,
  definitions,
  mayEdit,
  mayLookUp,
}: {
  organizationId: string;
  locations: Location[];
  definitions: FieldDefinition[];
  mayEdit: boolean;
  mayLookUp: boolean;
}) {
  return (
    <DataTable
      rows={locations}
      rowKey={(location) => location.id}
      empty="No locations yet."
      actions={
        mayEdit
          ? (location) => (
              <LocationCoordinatesDrawer organizationId={organizationId} location={location} mayLookUp={mayLookUp} />
            )
          : undefined
      }
      columns={[
        {
          key: 'label',
          header: 'Place',
          emphasis: 'primary',
          cell: (location) => (
            <Link href={`/organizations/${organizationId}/locations/${location.id}`} className="underline underline-offset-4">
              {location.label}
            </Link>
          ),
        },
        {
          key: 'address',
          header: 'Address',
          cell: (location) => location.address,
        },
        {
          key: 'accessNotes',
          header: 'Access notes',
          emphasis: 'secondary',
          cell: (location) => location.accessNotes,
        },
        {
          key: 'customers',
          header: 'Customers served',
          emphasis: 'secondary',
          cell: (location) =>
            location.customers.length > 0 ? location.customers.map((customer) => customer.name).join(', ') : null,
        },
        ...(!mayEdit
          ? [
              {
                key: 'coordinates',
                header: 'Coordinates',
                emphasis: 'secondary' as const,
                cell: (location: Location) =>
                  location.coordinates ? `${location.coordinates.latitude}, ${location.coordinates.longitude}` : null,
              },
            ]
          : []),
        ...(definitions.length > 0
          ? [
              {
                key: 'custom',
                header: 'Custom fields',
                emphasis: 'secondary' as const,
                cell: (location: Location) => <CustomFieldValues definitions={definitions} custom={location.custom} />,
              },
            ]
          : []),
      ]}
    />
  );
}
