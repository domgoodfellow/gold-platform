import 'server-only';

/**
 * The source revision this running application was built from — the Git commit whose renderers,
 * compositions and styles draw every page it serves. Distinct from a website's **content
 * revision** (Studio's numbered snapshots) and from the **deployment** a hostname points at
 * (provider state). A preview rendered here shows this build's renderer, which is the one serving
 * a hostname only when that hostname is assigned to this same deployment.
 *
 * Vercel exposes these system variables to every deployment; elsewhere (a local server, a test
 * run) they are absent and the build is reported as local rather than guessed.
 */
export type SourceRevision = {
  commit: string | null;
  shortCommit: string | null;
  branch: string | null;
  deploymentId: string | null;
  /** `production`, `preview`, `development`, or null when not running on Vercel. */
  environment: string | null;
};

export function sourceRevision(env: Record<string, string | undefined> = process.env): SourceRevision {
  const commit = env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  return {
    commit,
    shortCommit: commit ? commit.slice(0, 7) : null,
    branch: env.VERCEL_GIT_COMMIT_REF?.trim() || null,
    deploymentId: env.VERCEL_DEPLOYMENT_ID?.trim() || null,
    environment: env.VERCEL_ENV?.trim() || null,
  };
}

/** "Build cc0d8eb · production", or "Local build" when no provider names it. */
export function sourceRevisionLabel(revision: SourceRevision): string {
  if (!revision.shortCommit) return 'Local build';
  return revision.environment ? `Build ${revision.shortCommit} · ${revision.environment}` : `Build ${revision.shortCommit}`;
}
