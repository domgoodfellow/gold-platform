import { inSettingsContext } from '@/lib/settings-nav';

export const lastAppPathKey = (organizationId: string) => `gildops.lastAppPath.${organizationId}`;

/**
 * "Back to app" never trusts a stored or supplied address: only a path inside this business, that is
 * not itself a Settings page, not protocol-relative and without backslashes or control characters.
 * Anything else is dropped and the caller falls back to the business's Home.
 */
export function safeAppReturnPath(candidate: string | null | undefined, organizationId: string): string | null {
  if (!candidate) return null;
  const prefix = `/organizations/${organizationId}/`;
  if (!candidate.startsWith(prefix) || candidate.includes('\\') || [...candidate].some((char) => char.charCodeAt(0) < 32)) return null;
  if (inSettingsContext(candidate, organizationId)) return null;
  return candidate;
}
