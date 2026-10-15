import { ViewNav } from '@/components/navigation/view-nav';

export type IntegrationsView = 'connected' | 'mcp' | 'secrets';

/**
 * Connections' views — Connected, MCP servers, Secrets — as one
 * `ViewNav`. The App Library is reached from Connected's Add connections section and keeps a
 * breadcrumb back, so it is not a competing destination. Sources and Imports belong to Library.
 * A deep record keeps its own breadcrumb instead of repeating this nav.
 */
export function IntegrationsNav({ organizationId, current }: { organizationId: string; current: IntegrationsView }) {
  const base = `/organizations/${organizationId}/settings/connections`;

  return (
    <ViewNav
      label="Connections views"
      current={current}
      views={[
        { key: 'connected', label: 'Connected', href: base },
        { key: 'mcp', label: 'MCP servers', href: `${base}/mcp` },
        { key: 'secrets', label: 'Secrets & credentials', href: `/organizations/${organizationId}/settings/secrets` },
      ]}
    />
  );
}
