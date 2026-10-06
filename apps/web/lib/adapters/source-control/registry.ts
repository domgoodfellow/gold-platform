import { githubSourceControl } from './github';
import type { SourceControlReader } from './index';

/**
 * Which connectors are source control, and who reads their rows.
 *
 * **The only file outside a vendor's own that names one**, as `telephony/registry.ts` is for
 * carriers. It is a fact about vocabulary — "this connector's `github_repository` rows are
 * repositories" — and says nothing about whether this deployment can connect it: that is the API's
 * answer (`lib/domain/integrations/readiness.ts`), never this file's.
 */
const SOURCE_CONTROL: Record<string, SourceControlReader> = {
  github: githubSourceControl,
};

export function sourceControlConnectorKeys(): string[] {
  return Object.keys(SOURCE_CONTROL);
}

export function sourceControlReader(connectorKey: string): SourceControlReader | null {
  return SOURCE_CONTROL[connectorKey] ?? null;
}

/** Whether a connector's connection is a source-control one — what a screen asks before it says "repositories". */
export function isSourceControlConnector(connectorKey: string): boolean {
  return connectorKey in SOURCE_CONTROL;
}
