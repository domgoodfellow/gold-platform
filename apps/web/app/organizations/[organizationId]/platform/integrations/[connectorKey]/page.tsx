import { requirePlatformArea } from '@/lib/route/platform';
import { platformHref } from '@/lib/platform-navigation';
import { notFound } from 'next/navigation';
import { AppPage } from '@/components/containers/app-page';
import { PageHeader } from '@/components/containers/page-header';
import { DividedList, Section, SectionHeading } from '@/components/containers/section';
import { Badge } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { getDb } from '@/lib/db/server';
import { connectorLogoUrl, getConnector } from '@/lib/domain/integrations/connectors';
import { isConnectorImplemented } from '@/lib/adapters/integrations';
import { ConnectorIcon, isBuiltInConnector } from '@/features/integrations/catalogue/connector-icon';
import { AppForm, ConnectorForm, LogoForm, RemoveAppButton } from '@/features/platform/integrations/connector-form';

export const dynamic = 'force-dynamic';

const IMPLEMENTATION_LABEL: Record<string, string> = { planned: 'Planned', partial: 'Partial', available: 'Available' };

export default async function ConnectorPage({ params }: PageProps<'/organizations/[organizationId]/platform/integrations/[connectorKey]'>) {
  const { organizationId: goldId, connectorKey } = await params;
  await requirePlatformArea(goldId, 'platform.catalogue');
  const db = await getDb();
  const connector = await getConnector(db, connectorKey);
  if (!connector) notFound();

  const logoUrl = connector.iconRef ? connectorLogoUrl(db, connector.iconRef) : null;

  return (
    <AppPage>
      <PageHeader
        title={connector.name}
        crumbs={[{ label: 'Connectors', href: platformHref(goldId, 'integrations') }]}
        meta={<ConnectorIcon connector={connector} logoUrl={logoUrl} size="large" />}
      />
      {connector.status !== 'planned' && !isConnectorImplemented(connector.key) ? (
        <Hint className="block" role="status">
          This connector is {connector.status}, but this deployment has no adapter for it, so a business can browse it and cannot yet connect.
        </Hint>
      ) : null}

      <Section className="mt-6">
        <SectionHeading>Identity</SectionHeading>
        {isBuiltInConnector(connector.key) ? (
          <Hint className="mt-1 block">
            Built-in connector — shown with GOLD&apos;s own curated brand mark. There is nothing to upload here.
          </Hint>
        ) : logoUrl ? (
          // A public, unsigned URL — a logo is on a page a stranger opens.
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logoUrl} alt={`${connector.name} logo`} className="mt-2 h-12 w-auto" />
            <LogoForm connectorKey={connector.key} />
          </>
        ) : (
          <>
            <Hint className="mt-1 block">No logo yet — shown as a generic tile until one is uploaded.</Hint>
            <LogoForm connectorKey={connector.key} />
          </>
        )}
      </Section>

      <Section className="mt-8">
        <SectionHeading>Details</SectionHeading>
        <ConnectorForm connector={connector} />
      </Section>

      <Section className="mt-8">
        <SectionHeading>Apps inside this connector</SectionHeading>
        <Hint className="mt-1 block">
          One authorization can reach several apps. These describe what it covers; they are not
          separate connections — and each carries its own GOLD implementation state, never
          inherited from the connector above it.
        </Hint>
        {connector.apps.length === 0 ? (
          <Hint className="mt-2 block">None.</Hint>
        ) : (
          <DividedList className="mt-2">
            {connector.apps.map((app) => (
              <li key={app.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <div>
                  <span className="font-medium">{app.name}</span>
                  <span className="ml-2 text-sm text-muted">{app.description}</span>
                  {app.features.length > 0 ? (
                    <span className="mt-0.5 block text-xs text-subtle">
                      Supports: {app.features.map((feature) => feature.featureLabel).join(', ')}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={app.implementationState === 'available' ? 'success' : 'neutral'}>
                    {IMPLEMENTATION_LABEL[app.implementationState]}
                  </Badge>
                  <RemoveAppButton connectorKey={connector.key} appKey={app.key} />
                </div>
              </li>
            ))}
          </DividedList>
        )}
        <AppForm connectorKey={connector.key} />
      </Section>
    </AppPage>
  );
}
