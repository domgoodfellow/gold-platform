import { AREAS, currentSegment } from '@/lib/navigation';

/**
 * Where the person is, as far as the Agent may be told: the workspace they have open and, on a
 * record's own page, that record's id. Both come from the path alone — there is no separate
 * "selected record" state in this application, so this says nothing a URL does not.
 *
 * Used twice and it must be the same function: the Context popover shows what this returns, and
 * the server action re-derives it from the path it is sent (never from a label the browser
 * supplied) before anything reaches the answering side.
 */
export type AgentViewing = {
  /** The area's own label, exactly as navigation names it. */
  workspace: string | null;
  /** Set only on an area's record page, and only for a well-formed id. */
  recordId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveAgentViewing(pathname: string): AgentViewing {
  // /organizations/{id}/{area route}/{record}. Area routes can span segments (crm/contacts), so the
  // longest registered route that prefixes the path names the area.
  const parts = pathname.split(/[?#]/)[0].split('/').filter(Boolean);
  const rest = parts.slice(2);
  const routeOf = (candidate: (typeof AREAS)[number]) => (candidate.route ?? candidate.segment).split('/');
  const byRoute = AREAS.filter((candidate) => routeOf(candidate).every((part, index) => rest[index] === part))
    .sort((a, b) => routeOf(b).length - routeOf(a).length)[0];
  const area = byRoute ?? AREAS.find((candidate) => candidate.segment === currentSegment(pathname));
  if (!area) return { workspace: null, recordId: null };

  const depth = byRoute ? routeOf(byRoute).length : 1;
  const record = rest[0] === 'support' && rest[1] === 'cases' ? rest[2] : rest[depth];
  return { workspace: area.label, recordId: record && UUID.test(record) ? record : null };
}
