import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getConnector } from './connectors';
import { disconnectOAuth } from './oauth';

/**
 * A tenant's own authorization to an external system — a tenant Connection, never a platform Provider Account (ADR-016)
 * (`organization_provider_bindings`). The tenant holds the account; GOLD stores a reference.
 * See `supabase/migrations/20260914000001_a_tenant_connects_its_own_data_sources.sql`.
 */
export type IntegrationConnection = {
  id: string;
  connectorKey: string;
  accountLabel: string | null;
  status: 'connecting' | 'active' | 'needs_attention' | 'disconnected';
  scopes: string[];
  /** Safe user-facing verification failure; raw provider diagnostics stay in the server record. */
  lastError: string | null;
  connectedBy: string;
  lastVerifiedAt: string | null;
  createdAt: string;
};

const ACCOUNT_LABEL_MAX = 200;

export async function listConnections(
  db: Db,
  input: { organizationId: string },
): Promise<IntegrationConnection[]> {
  const { data, error } = await db
    .from('integration_connections')
    .select('id, connector_key, account_label, status, scopes, last_error, connected_by, last_verified_at, created_at')
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new DomainError(error.message, 'integrations.connections_list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    connectorKey: row.connector_key,
    accountLabel: row.account_label,
    status: row.status as IntegrationConnection['status'],
    scopes: row.scopes ?? [],
    lastError: row.last_error ? 'Connection verification failed. Reconnect the application.' : null,
    connectedBy: row.connected_by,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
  }));
}

export async function getConnection(
  db: Db,
  input: { organizationId: string; connectionId: string },
): Promise<IntegrationConnection | null> {
  const { data, error } = await db
    .from('integration_connections')
    .select('id, connector_key, account_label, status, scopes, last_error, connected_by, last_verified_at, created_at')
    .eq('organization_id', input.organizationId)
    .eq('id', input.connectionId)
    .maybeSingle();

  if (error) {
    throw new DomainError(error.message, 'integrations.connection_get_failed');
  }
  if (!data) return null;

  return {
    id: data.id,
    connectorKey: data.connector_key,
    accountLabel: data.account_label,
    status: data.status as IntegrationConnection['status'],
    scopes: data.scopes ?? [],
    lastError: data.last_error ? 'Connection verification failed. Reconnect the application.' : null,
    connectedBy: data.connected_by,
    lastVerifiedAt: data.last_verified_at,
    createdAt: data.created_at,
  };
}

/**
 * Record a connection this business now has to an external system. For a connector with no
 * OAuth handshake (`csv` — there is no account to authorize), this is called directly with a
 * fixed label; a connector behind `lib/adapters/` calls it once the vendor's own flow completes.
 */
export async function recordConnection(
  db: Db,
  input: { organizationId: string; connectorKey: string; accountLabel?: string },
): Promise<string> {
  await requireActor(db);

  const accountLabel = input.accountLabel?.trim() || null;
  if (accountLabel !== null && accountLabel.length > ACCOUNT_LABEL_MAX) {
    throw new DomainError(
      `That name is longer than ${ACCOUNT_LABEL_MAX} characters.`,
      'integrations.account_label_too_long',
    );
  }

  const { data, error } = await db.rpc('record_integration_connection', {
    p_organization_id: input.organizationId,
    p_connector_key: input.connectorKey,
    p_account_label: accountLabel as string,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot connect data sources here.', 'integrations.forbidden');
    }
    throw new DomainError(error.message, 'integrations.connect_failed');
  }

  return data;
}

/**
 * Retire a connection. Never touches a resource, a mapping, a run or a link — imported customers
 * stay exactly as they are, which is the one guarantee this screen has to keep.
 */
export async function disconnectConnection(
  db: Db,
  input: { organizationId: string; connectionId: string },
): Promise<void> {
  await requireActor(db);

  // A connection made through a vendor's sign-in, or to an MCP server with an access token, holds a
  // credential only the API can reach, so it is the API that revokes upstream, deletes it and
  // retires the connection.
  const connection = await getConnection(db, input);
  const connector = connection ? await getConnector(db, connection.connectorKey) : null;
  if (connector && (connector.authMethod !== 'none' || connector.connectionMethod === 'mcp')) {
    await disconnectOAuth(db, { connectionId: input.connectionId });
    return;
  }

  const { error } = await db.rpc('disconnect_integration', {
    p_organization_id: input.organizationId,
    p_connection_id: input.connectionId,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot disconnect this.', 'integrations.forbidden');
    }
    throw new DomainError(error.message, 'integrations.disconnect_failed');
  }
}
