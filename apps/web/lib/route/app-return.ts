import { inSettingsContext } from '@/lib/settings-nav';
import { AREAS, areaHref, workspaceConfigurationTarget } from '@/lib/navigation';

export const lastAppPathKey = (organizationId: string) => `gildops.lastAppPath.${organizationId}`;

/**
 * "Back to app" never trusts a stored or supplied address: only a path inside this business, that is
 * not itself a Settings page, not protocol-relative and without backslashes or control characters.
 * Anything else is dropped and the caller falls back to the business's Home.
 */
export function safeAppReturnPath(candidate: string | null | undefined, organizationId: string, allowedHrefs?: readonly string[]): string | null {
  if (!candidate) return null;
  const prefix = `/organizations/${organizationId}/`;
  if (!candidate.startsWith(prefix) || candidate.includes('\\') || [...candidate].some((char) => char.charCodeAt(0) < 32)) return null;
  if (inSettingsContext(candidate, organizationId)) return null;
  const path = candidate.split(/[?#]/)[0].replace(/\/$/, '');
  if (allowedHrefs) {
    const target = workspaceConfigurationTarget(path);
    if (target && !allowedHrefs.includes(`/organizations/${organizationId}/${target.path}`)) return null;
    const area = AREAS.filter(area => path === areaHref(organizationId, area.segment) || path.startsWith(`${areaHref(organizationId, area.segment)}/`)).sort((a, b) => areaHref(organizationId, b.segment).length - areaHref(organizationId, a.segment).length)[0];
    if (!target && !allowedHrefs.includes(path) && area && !allowedHrefs.includes(areaHref(organizationId, area.segment))) return null;
  }
  if (allowedHrefs && !allowedHrefs.some((href) => path === href || path.startsWith(`${href}/`))) return null;
  return candidate;
}
