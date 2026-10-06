import type { SourceControlReader, SourceRepository, SourceRepositoryVisibility } from './index';

/**
 * How one vendor's repository rows read as the vendor-neutral shape. The metadata is written only by
 * the API's discovery (`apps/api/app/connectors/github.py`); this reads it back defensively, because
 * a row that does not look like a repository is skipped rather than guessed at.
 */
const VISIBILITIES = new Set<SourceRepositoryVisibility>(['public', 'private', 'internal']);

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

export const githubSourceControl: SourceControlReader = {
  resourceTypes: ['github_repository'],
  toRepository(row): SourceRepository | null {
    const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>;
    const owner = text(metadata.owner);
    const name = text(metadata.name);
    if (!owner || !name) return null;
    const visibility = text(metadata.visibility) as SourceRepositoryVisibility | null;
    return {
      id: row.id,
      connectionId: row.connectionId,
      owner,
      name,
      fullName: row.displayName,
      defaultBranch: text(metadata.default_branch),
      visibility: visibility && VISIBILITIES.has(visibility) ? visibility : 'private', // when in doubt, the more cautious reading
      archived: metadata.archived === true,
      url: text(metadata.url),
    };
  },
};
