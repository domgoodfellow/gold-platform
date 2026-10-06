import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { sourceControlConnectorKeys, sourceControlReader, type SourceRepository } from '@/lib/adapters/source-control';

/**
 * The repositories this business has authorized GildOps to use — across every source-control
 * connection, in one vendor-neutral shape. **This is what Studio asks for.** It names no vendor:
 * which connectors are source control, and how one's rows read as a repository, is
 * `lib/adapters/source-control`'s alone.
 *
 * What it returns is the business's own authorization as the API last observed it. A repository
 * appears only while its connection is `active` and the row is `active`; a connection that needs
 * attention, was disconnected, or lost an installation offers nothing, so a caller never builds on
 * access the vendor has since withdrawn. Nothing here writes: the rows are machine-authored and a
 * tenant cannot assert one (`20261103000001`).
 */

type Row = {
  id: string;
  connection_id: string | null;
  resource_type: string;
  display_name: string;
  metadata: unknown;
  integration_connections: { connector_key: string; status: string } | null;
};

export async function listSourceRepositories(
  db: Db,
  input: { organizationId: string },
): Promise<SourceRepository[]> {
  const { data, error } = await db
    .from('integration_resources')
    .select('id, connection_id, resource_type, display_name, metadata, integration_connections!inner(connector_key, status)')
    .eq('organization_id', input.organizationId)
    .eq('status', 'active')
    .eq('integration_connections.status', 'active')
    .in('integration_connections.connector_key', sourceControlConnectorKeys())
    .order('display_name');

  if (error) throw new DomainError('The authorized repositories could not be read.', 'source_control.list_failed');

  const repositories: SourceRepository[] = [];
  for (const row of (data ?? []) as unknown as Row[]) {
    const connection = row.integration_connections;
    const reader = connection ? sourceControlReader(connection.connector_key) : null;
    if (!reader || !row.connection_id || !reader.resourceTypes.includes(row.resource_type)) continue;
    const repository = reader.toRepository({
      id: row.id,
      connectionId: row.connection_id,
      displayName: row.display_name,
      metadata: row.metadata,
    });
    if (repository) repositories.push(repository);
  }
  return repositories;
}

/** One authorized repository by GildOps' own id, or `null` — never another business's, never a withdrawn one. */
export async function getSourceRepository(
  db: Db,
  input: { organizationId: string; repositoryId: string },
): Promise<SourceRepository | null> {
  const all = await listSourceRepositories(db, { organizationId: input.organizationId });
  return all.find((repository) => repository.id === input.repositoryId) ?? null;
}

/** For a caller that must hold a repository: the same lookup, refusing in a sentence when it is not there. */
export async function requireSourceRepository(
  db: Db,
  input: { organizationId: string; repositoryId: string },
): Promise<SourceRepository> {
  const repository = await getSourceRepository(db, input);
  if (!repository) {
    throw new DomainError('That repository is not authorized for this business, or its connection needs attention.', 'source_control.not_authorized');
  }
  return repository;
}
