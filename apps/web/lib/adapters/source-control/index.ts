/**
 * Source control as a capability: *which repositories has this business authorized GildOps to
 * use*, in one vendor-neutral shape.
 *
 * Studio — and anything else that wants a repository — asks for this and never names a vendor. The
 * vendor's vocabulary (what its resource rows are called, where it keeps a default branch) lives in
 * one file per vendor beside this one, chosen by `registry.ts`. A repository is not a connection
 * and not a Studio project: the connection is the business's authorization, the repository is one
 * thing it reaches, and a Studio project is a separate thing that may point at one.
 */

export type SourceRepositoryVisibility = 'public' | 'private' | 'internal';

export type SourceRepository = {
  /** GildOps' own stable id for the authorized repository — what a caller keeps. Never the vendor's. */
  id: string;
  connectionId: string;
  /** The account or organization the repository belongs to, as the vendor names it. */
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  visibility: SourceRepositoryVisibility;
  archived: boolean;
  url: string | null;
};

/** What a vendor's implementation says about the rows it wrote. */
export type SourceControlReader = {
  /** The `integration_resources.resource_type` values that are repositories for this vendor. */
  resourceTypes: readonly string[];
  /** One authorized resource row as a repository, or `null` when it does not describe one. */
  toRepository(row: { id: string; connectionId: string; displayName: string; metadata: unknown }): SourceRepository | null;
};

/** Which connectors are source control, and who reads their rows — chosen in `registry.ts`, the only file that names a vendor. */
export { isSourceControlConnector, sourceControlConnectorKeys, sourceControlReader } from './registry';
