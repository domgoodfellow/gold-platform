import Link from 'next/link';
import { areaLabel } from '@/lib/navigation';
import { PageHeader } from '@/components/containers/page-header';
import { ButtonLink, Button } from '@/components/controls/button';
import { Hint, TextInput } from '@/components/controls/inputs';
import { cx, FOCUS_RING } from '@/components/class-names';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import { Badge } from '@/components/display/data';
import { Widget, WidgetGrid } from '@/components/display/widget';
import { listConnections } from '@/lib/domain/integrations/connections';
import {
  connectorCategories,
  connectorLogoUrl,
  filterConnectors,
  listConnectors,
} from '@/lib/domain/integrations/connectors';
import { listResources } from '@/lib/domain/integrations/resources';
import { listImportRuns } from '@/lib/domain/integrations/import-runs';
import { requireOrganization } from '@/lib/route/organization';
import { ConnectorCard } from '@/features/integrations/connector-card';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { DisconnectForm } from './connection-actions';

export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  connecting: 'Connecting',
  active: 'Connected',
  needs_attention: 'Needs attention',
  disconnected: 'Disconnected',
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function IntegrationsPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/integrations'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const view = first(query.view) === 'browse' ? 'browse' : 'connected';
  const q = first(query.q)?.trim() ?? '';
  const category = first(query.category) ?? '';
  const oauthError = first(query.oauth_error);
  const { db, organization } = await requireOrganization(organizationId);

  const [connections, resources, runs, connectors] = await Promise.all([
    listConnections(db, { organizationId }),
    listResources(db, { organizationId }),
    listImportRuns(db, { organizationId }),
    listConnectors(db),
  ]);

  const mayManage = organization.capabilities.includes('integration.manage');
  const active = connections.filter((connection) => connection.status !== 'disconnected');
  const needsAttention = connections.filter((connection) => connection.status === 'needs_attention');
  const byKey = new Map(connectors.map((connector) => [connector.key, connector]));
  const connectedKeys = new Set(active.map((connection) => connection.connectorKey));

  const categories = connectorCategories(connectors);
  const shown = filterConnectors(connectors, { query: q, category });
  const browseHref = (next: { q?: string; category?: string }) => {
    const params = new URLSearchParams({ view: 'browse' });
    if (next.q) params.set('q', next.q);
    if (next.category) params.set('category', next.category);
    return `/organizations/${organizationId}/integrations?${params}`;
  };

  return (
    <>
      <PageHeader title={areaLabel('integrations')} description="Connect GOLD to the apps and files your organization already uses." />
      <IntegrationsNav organizationId={organizationId} current={view} />
      {oauthError ? (
        <Hint className="mt-4 block" role="alert">
          {oauthError}
        </Hint>
      ) : null}

      {view === 'connected' ? (
        <>
          <WidgetGrid className="mt-6">
            <Widget title="Connected apps" value={active.length} />
            <Widget title="Data sources" value={resources.length} href={`/organizations/${organizationId}/integrations/sources`} />
            <Widget title="Imports" value={runs.length} href={`/organizations/${organizationId}/integrations/imports`} />
            <Widget
              title="Needs attention"
              value={needsAttention.length}
              note={needsAttention.length > 0 ? 'A connection has stopped working.' : undefined}
            />
          </WidgetGrid>

          <Section className="mt-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SectionHeading>Connected</SectionHeading>
              {connectedKeys.has('csv') ? (
                <ButtonLink href={`/organizations/${organizationId}/integrations/imports/new`} tone="primary" size="small">
                  Import file
                </ButtonLink>
              ) : null}
            </div>
            {active.length === 0 ? (
              <EmptyState className="mt-2">
                Nothing connected yet. <Link href={browseHref({})} className="underline underline-offset-4">Browse apps</Link>
              </EmptyState>
            ) : (
              <DividedList className="mt-2">
                {active.map((connection) => {
                  const connector = byKey.get(connection.connectorKey);
                  return (
                    <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="flex items-center gap-3">
                        {connector?.iconRef ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={connectorLogoUrl(db, connector.iconRef)} alt="" className="h-6 w-6 object-contain" />
                        ) : null}
                        <div>
                          <Link
                            href={`/organizations/${organizationId}/integrations/${connection.id}`}
                            className="font-medium underline-offset-4 hover:underline"
                          >
                            {connector?.name ?? connection.connectorKey}
                          </Link>
                          <p className="text-sm text-muted">{connection.accountLabel ?? connector?.category ?? ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge tone={connection.status === 'active' || connection.status === 'connecting' ? 'success' : 'neutral'}>
                          {STATUS_LABEL[connection.status] ?? connection.status}
                        </Badge>
                        {mayManage ? <DisconnectForm organizationId={organizationId} connectionId={connection.id} /> : null}
                      </div>
                    </li>
                  );
                })}
              </DividedList>
            )}
          </Section>
        </>
      ) : (
        <Section className="mt-6">
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="view" value="browse" />
            {category ? <input type="hidden" name="category" value={category} /> : null}
            <TextInput name="q" type="search" defaultValue={q} placeholder="Search apps" aria-label="Search apps" className="w-full sm:w-72" />
            <Button type="submit" tone="secondary" size="small">Search</Button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Category">
            {['', ...categories].map((name) => (
              <Link
                key={name || 'all'}
                href={browseHref({ q, category: name })}
                aria-current={category === name ? 'true' : undefined}
                className={cx(
                  'rounded-full border px-3 py-1 text-sm',
                  FOCUS_RING,
                  category === name ? 'border-accent bg-accent text-on-accent' : 'border-border text-muted hover:text-foreground',
                )}
              >
                {name || 'All'}
              </Link>
            ))}
          </div>

          {shown.length === 0 ? (
            <EmptyState className="mt-4">No app matches that search.</EmptyState>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {shown.map((connector) => (
                <ConnectorCard
                  key={connector.key}
                  connector={connector}
                  logoUrl={connector.iconRef ? connectorLogoUrl(db, connector.iconRef) : null}
                  organizationId={organizationId}
                  connected={connectedKeys.has(connector.key)}
                  mayManage={mayManage}
                />
              ))}
            </div>
          )}
        </Section>
      )}
    </>
  );
}
