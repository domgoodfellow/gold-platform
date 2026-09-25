import type { FileCategory, FileFormat } from './formats';

/**
 * Which artifacts an organization lets in. This is policy, not permission: permission is *who* may
 * upload or import (the caller's capabilities, checked where the operation runs); policy is *what*
 * may enter and how large. Neither implies the other, and neither says a parser exists — that is
 * the format registry's claim.
 *
 * The platform default is the only policy today. Nothing stores a per-organization one yet, so a
 * caller passes none and gets the default; when a business can set its own, the value arrives
 * through the same parameter and no call site changes.
 */
export type FileIngestionPolicy = {
  enabled: boolean;
  allowedCategories: readonly FileCategory[];
  /** Admitted in addition to whole categories. */
  allowedMimeTypes: readonly string[];
  maxFileSizeMb: number;
};

export const PLATFORM_FILE_POLICY: FileIngestionPolicy = {
  enabled: true,
  allowedCategories: ['structured-data', 'document', 'presentation', 'image'],
  allowedMimeTypes: [],
  maxFileSizeMb: 25,
};

export function policyAllows(policy: FileIngestionPolicy, format: FileFormat): boolean {
  return (
    policy.enabled &&
    (policy.allowedCategories.includes(format.category) || policy.allowedMimeTypes.includes(format.mimeType))
  );
}

export function policyMaxBytes(policy: FileIngestionPolicy): number {
  return policy.maxFileSizeMb * 1024 * 1024;
}
