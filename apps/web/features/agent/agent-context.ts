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
  const segment = currentSegment(pathname);
  const area = AREAS.find((candidate) => candidate.segment === segment);
  if (!area) return { workspace: null, recordId: null };

  // /organizations/{id}/{area}/{record}
  const record = pathname.split(/[?#]/)[0].split('/').filter(Boolean)[3];
  return { workspace: area.label, recordId: record && UUID.test(record) ? record : null };
}
