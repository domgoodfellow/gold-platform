import { ViewNav } from '@/components/navigation/view-nav';

export type IntegrationsView = 'connected' | 'browse' | 'mcp' | 'sources' | 'imports' | 'secrets';

/**
 * Connections' views — Connected, Browse apps, MCP servers, Secrets — as one
 * `ViewNav`, rendered consistently on all four. Connected and Browse are query-string views of
 * the root route; Data sources and Imports are their own routes, so this is plain `<Link>`s
 * either way (`ViewNav`'s own contract), not a client tab controller. A deep record or run keeps
 * its own breadcrumb instead of repeating this nav — record grammar, not a fifth view.
 */
export function IntegrationsNav({ organizationId, current }: { organizationId: string; current: IntegrationsView }) {
  const base = `/organizations/${organizationId}/settings/connections`;

  return (
    <ViewNav
      label="Connections views"
      current={current}
      views={[
        { key: 'connected', label: 'Connected', href: base },
        { key: 'browse', label: 'Browse apps', href: `${base}/apps` },
        { key: 'mcp', label: 'MCP servers', href: `${base}/mcp` },
        { key: 'secrets', label: 'Secrets & credentials', href: `/organizations/${organizationId}/settings/secrets` },
      ]}
    />
  );
}
