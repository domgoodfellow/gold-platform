// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedApps } from '@/features/integrations/connections/connected-apps';
import { IntegrationsNav } from '@/features/integrations/integrations-nav';
import { LibraryNav } from '@/features/library/library-nav';
import { libraryHref, libraryImportHref, libraryNewImportHref, librarySourceHref } from '@/lib/route/library';
import type { Connector } from '@/lib/domain/integrations/connectors';
import type { IntegrationConnection } from '@/lib/domain/integrations/connections';
import LegacyImports from '@/app/organizations/[organizationId]/integrations/imports/page';
import LegacyNewImport from '@/app/organizations/[organizationId]/integrations/imports/new/page';
import LegacyImportRun from '@/app/organizations/[organizationId]/integrations/imports/[runId]/page';
import LegacySources from '@/app/organizations/[organizationId]/integrations/sources/page';
import LegacySource from '@/app/organizations/[organizationId]/integrations/sources/[resourceId]/page';

vi.mock('@/features/integrations/connections/connection-controls', () => ({ DisconnectForm: () => <button>Disconnect</button> }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/organizations/org/library/sources',
  redirect: (target: string) => { throw new Error(`REDIRECT:${target}`); },
}));
afterEach(cleanup);

const connector = (key: string, name: string): Connector => ({ key, name, description: `${name} description`, category: 'Files', iconRef: null } as unknown as Connector);
const connection = { id: 'c1', connectorKey: 'dropbox', accountLabel: 'Ops Dropbox', status: 'active' } as IntegrationConnection;
const renderApps = (active: IntegrationConnection[], connectable: Connector[], mayManage = true) => render(
  <ConnectedApps organizationId="org" active={active} connectorByKey={new Map([['dropbox', connector('dropbox', 'Dropbox')]])} logoUrlByKey={new Map()}
    needsAttentionCount={0} mayManage={mayManage} catalogOpen={false} catalogHref="/organizations/org/settings/connections?catalog=open#app-library"
    connectable={connectable} organizationName="Acme" mcpServerCount={0} />,
);

describe('Settings → Connections is the operating page', () => {
  it('shows connected accounts first, then suggestions limited to what is connectable and not yet connected', () => {
    renderApps([connection], [connector('dropbox', 'Dropbox'), connector('slack', 'Slack')]);
    const connected = screen.getByRole('heading', { name: 'Connected' });
    const add = screen.getByRole('heading', { name: 'Add connections' });
    expect(connected.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Dropbox' })).toHaveAttribute('href', '/organizations/org/settings/connections/c1');
    expect(screen.getAllByRole('link', { name: 'Connect' })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Connect' })).toHaveAttribute('href', '/organizations/org/settings/connections/connect/slack');
    expect(screen.getByRole('link', { name: 'Browse the App Library' })).toHaveAttribute('href', '/organizations/org/settings/connections?catalog=open#app-library');
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
  it('offers to hide an open catalog from the same page', () => {
    render(<ConnectedApps organizationId="org" active={[connection]} connectorByKey={new Map()} logoUrlByKey={new Map()} 
      needsAttentionCount={0} mayManage catalogOpen catalogHref="/organizations/org/settings/connections" connectable={[]} organizationName="Acme" mcpServerCount={0} />);
    const toggle = screen.getByRole('link', { name: 'Hide the App Library' });
    expect(toggle).toHaveAttribute('href', '/organizations/org/settings/connections');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
  it('advertises nothing when nothing is connectable, and offers no Connect without permission', () => {
    renderApps([], []);
    expect(screen.getByText('Nothing else is available to connect right now.')).toBeVisible();
    cleanup();
    renderApps([], [connector('slack', 'Slack')], false);
    expect(screen.queryByRole('link', { name: 'Connect' })).not.toBeInTheDocument();
  });
  it('keeps data sources and imports out of Connections, and the App Library out of the section tabs', () => {
    renderApps([connection], []);
    // Sources and imports are Library's. Connections only shows the accounts it authorizes.
    expect(screen.queryByRole('link', { name: /Data sources/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Imports/ })).not.toBeInTheDocument();
    cleanup();
    render(<IntegrationsNav organizationId="org" current="connected" />);
    expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual(['Connected', 'MCP servers', 'Secrets & credentials']);
  });
});

describe('Library owns Sources and Imports', () => {
  it('derives every destination from the Library route helpers', () => {
    expect(libraryHref('org', 'sources')).toBe('/organizations/org/library/sources');
    expect(librarySourceHref('org', 'r1')).toBe('/organizations/org/library/sources/r1');
    expect(libraryImportHref('org', 'run', '?status=failed')).toBe('/organizations/org/library/imports/run?status=failed');
    expect(libraryNewImportHref('org', 'r1')).toBe('/organizations/org/library/imports/new?resourceId=r1');
    expect(libraryNewImportHref('org')).toBe('/organizations/org/library/imports/new');
  });
  it('lists Sources and Imports as Library sections', () => {
    render(<LibraryNav organizationId="org" active="imports" />);
    expect(screen.getByRole('link', { name: 'Sources' })).toHaveAttribute('href', '/organizations/org/library/sources');
    expect(screen.getByRole('link', { name: 'Imports' })).toHaveAttribute('aria-current', 'page');
  });
  const redirectOf = async (call: () => Promise<unknown>) => {
    try { await call(); } catch (error) { return (error as Error).message.replace('REDIRECT:', ''); }
    return null;
  };
  const search = () => Promise.resolve({ resourceId: 'r1', status: ['a', 'b'] });
  const org = () => Promise.resolve({ organizationId: 'org' });
  it.each([
    ['imports', () => LegacyImports({ params: org(), searchParams: search() }), '/organizations/org/library/imports?resourceId=r1&status=a&status=b'],
    ['new import', () => LegacyNewImport({ params: org(), searchParams: search() }), '/organizations/org/library/imports/new?resourceId=r1&status=a&status=b'],
    ['import run', () => LegacyImportRun({ params: Promise.resolve({ organizationId: 'org', runId: 'run' }), searchParams: search() }), '/organizations/org/library/imports/run?resourceId=r1&status=a&status=b'],
    ['sources', () => LegacySources({ params: org(), searchParams: search() }), '/organizations/org/library/sources?resourceId=r1&status=a&status=b'],
    ['source', () => LegacySource({ params: Promise.resolve({ organizationId: 'org', resourceId: 'r1' }), searchParams: search() }), '/organizations/org/library/sources/r1?resourceId=r1&status=a&status=b'],
  ])('redirects the legacy %s route, keeping its query', async (_name, call, expected) => {
    expect(await redirectOf(call)).toBe(expected);
  });
  it('leaves no link to a legacy integrations source or import route outside the redirect pages', () => {
    const root = join(__dirname, '..', '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        const posix = path.replaceAll('\\', '/');
        if (name === 'node_modules' || name === '.next') continue;
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.(ts|tsx)$/.test(name) || posix.includes('[organizationId]/integrations/')) continue;
        const text = readFileSync(path, 'utf8').replace(/@\/lib\/domain\/integrations\/\w+/g, '');
        if (/\/organizations\/(\$\{\w+\}|[^/'"`]+)\/integrations\/(sources|imports)/.test(text)) offenders.push(path.slice(root.length));
      }
    };
    for (const dir of ['app', 'features', 'lib', 'components']) walk(join(root, dir));
    expect(offenders).toEqual([]);
  });
});
