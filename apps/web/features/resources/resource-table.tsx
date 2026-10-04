import Link from 'next/link';
import { CustomFieldValues } from '@/features/custom-fields/values';
import { DataTable } from '@/components/display/table';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { Badge } from '@/components/display/data';
import { RESOURCE_CLASS_LABELS } from '@/lib/domain/resources/resource-class';
import type { Resource } from '@/lib/domain/resources/resources';

/** Resources, as a table above a breakpoint and cards below it (`DataTable`'s own rule) — the one listing, owned here rather than inlined into the route. */
export function ResourceTable({
  organizationId,
  resources,
  definitions,
}: {
  organizationId: string;
  resources: Resource[];
  definitions: FieldDefinition[];
}) {
  return (
    <DataTable
      rows={resources}
      rowKey={(resource) => resource.id}
      empty="No resources yet."
      columns={[
        {
          key: 'name',
          header: 'Name',
          emphasis: 'primary',
          cell: (resource) => (
            <Link
              href={`/organizations/${organizationId}/resources/${resource.id}`}
              className="underline underline-offset-4"
            >
              {resource.name}
            </Link>
          ),
        },
        {
          // Words, not an icon or a colour — the class is what the row is.
          key: 'class',
          header: 'Type',
          cell: (resource) => RESOURCE_CLASS_LABELS[resource.resourceClass],
        },
        {
          key: 'capabilities',
          header: 'Capabilities',
          cell: (resource) =>
            resource.capabilities.length === 0 ? (
              '—'
            ) : (
              <span className="flex flex-wrap gap-1">
                {resource.capabilities.map((capability) => (
                  <Badge key={capability.id}>{capability.name}</Badge>
                ))}
              </span>
            ),
        },
        {
          key: 'member',
          header: 'Represents member',
          cell: (resource) =>
            resource.resourceClass === 'person' ? (resource.member ? resource.member.displayName : 'No login') : '—',
        },
        ...(definitions.length > 0
          ? [
              {
                key: 'custom',
                header: 'Details',
                cell: (resource: Resource) => <CustomFieldValues definitions={definitions} custom={resource.custom} />,
              },
            ]
          : []),
      ]}
    />
  );
}
