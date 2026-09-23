import { ButtonLink } from '@/components/controls/button';
import { DataTable } from '@/components/display/table';
import { Badge } from '@/components/display/data';
import type { IntegrationResource } from '@/lib/domain/integrations/resources';

/**
 * Every Resource this business has selected, across every Connection — the distinction from
 * Imports staying exactly what it was: a Resource is a reachable thing (a sheet, a folder, a
 * mailbox), not automatically imported data. What was actually brought in lives on the Imports
 * view instead.
 */
export function SourcesTable({
  organizationId,
  resources,
  connectionLabel,
}: {
  organizationId: string;
  resources: IntegrationResource[];
  connectionLabel: Map<string, string>;
}) {
  return (
    <DataTable
      rows={resources}
      rowKey={(resource) => resource.id}
      empty="No data sources yet. Connect an app or upload a file to add one."
      columns={[
        { key: 'name', header: 'Resource', emphasis: 'primary', cell: (r) => r.displayName },
        { key: 'type', header: 'Type', cell: (r) => r.resourceType.replace(/_/g, ' ') },
        { key: 'connection', header: 'From', cell: (r) => connectionLabel.get(r.connectionId) ?? '—' },
        {
          key: 'status',
          header: 'Status',
          cell: (r) => <Badge tone={r.status === 'active' ? 'success' : 'neutral'}>{r.status.replace(/_/g, ' ')}</Badge>,
        },
        {
          key: 'actions',
          header: 'Import',
          emphasis: 'secondary',
          cell: (r) => (
            <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new?resourceId=${r.id}`} tone="text" size="small">
              Import →
            </ButtonLink>
          ),
        },
      ]}
    />
  );
}
