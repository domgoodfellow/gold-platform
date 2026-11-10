import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadHeaderConnections } from '@/lib/application/shell/connection-menu';
import { connectionAccountGroups } from '@/lib/application/shell/connection-menu-model';
import type { Connector } from '@/lib/domain/integrations/connectors';
import type { IntegrationConnection } from '@/lib/domain/integrations/connections';
import type { ConfigGate } from '@/lib/navigation';
import type { Db } from '@/lib/db/types';

const reads = vi.hoisted(() => ({ accounts: vi.fn(), catalogue: vi.fn(), readiness: vi.fn() }));
vi.mock('@/lib/domain/integrations/connections', () => ({ listConnections: reads.accounts }));
vi.mock('@/lib/domain/integrations/connectors', async original => ({ ...await original<typeof import('@/lib/domain/integrations/connectors')>(), listConnectors: reads.catalogue }));
vi.mock('@/lib/domain/integrations/readiness', () => ({ loadConnectorReadiness: reads.readiness }));
const db = {} as Db;
const gate: ConfigGate = { enabledModules: new Set(['integrations']), featureAvailability: new Set(['app_connections']), capabilities: new Set(['integration.manage']) };
const connector = (key: string, name: string): Connector => ({ id: key, key, name, description: '', category: 'Files', suite: null, status: 'beta', authMethod: 'oauth2', connectionMethod: 'native', isPublic: true, displayOrder: 0, iconRef: null, marketingSlug: null, marketingSummary: '', marketingDescription: '', capabilities: ['app_connections'], apps: [] });
const connection = (id: string, key: string, status: IntegrationConnection['status'] = 'active'): IntegrationConnection => ({ id, connectorKey: key, accountLabel: `${id} account`, status, scopes: ['private-scope'], lastError: 'private-diagnostic', connectedBy: 'private-user', lastVerifiedAt: null, createdAt: '2026-11-10T12:00:00Z' });

beforeEach(() => {
  vi.clearAllMocks();
  reads.accounts.mockResolvedValue([connection('g', 'google_workspace', 'needs_attention'), connection('m', 'microsoft_365')]);
  reads.catalogue.mockResolvedValue([connector('google_workspace', 'Google Workspace'), connector('microsoft_365', 'Microsoft 365')]);
  reads.readiness.mockResolvedValue(new Map([['google_workspace', { implemented: true, configured: true, reason: null }]]));
});

describe('header Connections projection', () => {
  it.each([
    { ...gate, capabilities: new Set<never>() },
    { ...gate, capabilities: new Set(['secret.manage'] as const) },
    { ...gate, enabledModules: new Set<string>(), featureAvailability: new Set<string>() },
  ])('loads no account or catalogue metadata without the Connections door', async denied => {
    expect(await loadHeaderConnections(db, { organizationId: 'tenant', gate: denied })).toBeNull();
    Object.values(reads).forEach(read => expect(read).not.toHaveBeenCalled());
  });
  it('uses tenant-scoped accounts and catalogue relevance without serializing credential-adjacent metadata', async () => {
    const result = await loadHeaderConnections(db, { organizationId: 'tenant', gate });
    expect(result?.state).toBe('ready');
    expect(reads.accounts).toHaveBeenCalledWith(db, { organizationId: 'tenant' });
    expect(reads.readiness).not.toHaveBeenCalled();
    expect(result?.accounts[0].workspaces).toContain('crm');
    expect(result?.accounts[0].reconnectHref).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/private-scope|private-diagnostic|private-user|scopes|connectedBy/);
  });
  it('only offers a reconnect for supported, currently available authentication', async () => {
    const result = await loadHeaderConnections(db, { organizationId: 'tenant', gate, includeReadiness: true });
    expect(result?.accounts[0].reconnectHref).toBe('/organizations/tenant/settings/connections/connect/google_workspace?connection=g');
    expect(result?.accounts[0].reconnectsExternally).toBe(true);
    expect(result?.accounts[1].reconnectHref).toBeNull();
    reads.readiness.mockResolvedValue(new Map());
    expect((await loadHeaderConnections(db, { organizationId: 'tenant', gate, includeReadiness: true }))?.accounts[0].reconnectHref).toBeNull();
    reads.catalogue.mockResolvedValue([{ ...connector('google_workspace', 'Google Workspace'), status: 'planned' }]);
    reads.readiness.mockResolvedValue(new Map([['google_workspace', { implemented: true, configured: true }]]));
    expect((await loadHeaderConnections(db, { organizationId: 'tenant', gate, includeReadiness: true }))?.accounts[0].reconnectHref).toBeNull();
  });
  it('keeps disconnected records distinct from accounts needing attention, and MCP under its own owner', async () => {
    reads.accounts.mockResolvedValue([connection('gone', 'google_workspace', 'disconnected'), connection('mcp', 'mcp_server', 'needs_attention')]);
    reads.catalogue.mockResolvedValue([connector('google_workspace', 'Google Workspace'), { ...connector('mcp_server', 'MCP server'), connectionMethod: 'mcp' }]);
    const result = await loadHeaderConnections(db, { organizationId: 'tenant', gate, includeReadiness: true });
    expect(result?.accounts[0].status).toBe('disconnected');
    expect(result?.accounts[1].manageHref).toBe('/organizations/tenant/settings/connections/mcp');
    expect(result?.accounts[1].reconnectHref).toBeNull();
  });
  it('distinguishes a failed source from a true empty account collection', async () => {
    reads.accounts.mockRejectedValueOnce(new Error('database detail'));
    expect(await loadHeaderConnections(db, { organizationId: 'tenant', gate })).toEqual({ state: 'unavailable', accounts: [], manageHref: '/organizations/tenant/settings/connections' });
    reads.accounts.mockResolvedValue([]);
    expect((await loadHeaderConnections(db, { organizationId: 'tenant', gate }))?.state).toBe('ready');
  });
  it('orders the same organization accounts by the current catalogue workspace without copying them', async () => {
    const result = (await loadHeaderConnections(db, { organizationId: 'tenant', gate }))!;
    const crm = connectionAccountGroups(result.accounts, 'crm');
    expect(crm.relevant.map(account => account.id)).toEqual(['g']);
    expect(crm.other.map(account => account.id)).toEqual(['m']);
    expect(crm.relevant[0]).toBe(result.accounts[0]);
    expect(connectionAccountGroups(result.accounts, 'communications').relevant).toHaveLength(2);
  });
});
