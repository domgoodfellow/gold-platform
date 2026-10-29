/** Dispatch links preserve context; changing a criterion starts the queue at its first page. */
export function dispatchHref(organizationId: string, state: Record<string, string>, changes: Record<string, string> = {}) {
  const next = { ...state, ...changes };
  const criteria = ['on', 'q', 'type', 'status', 'resource', 'class', 'assignment'];
  if (criteria.some(key => key in changes && changes[key] !== state[key])) {
    delete next.page;
    delete next.selected;
  }
  if ('type' in changes && changes.type !== state.type) delete next.status;
  const params = new URLSearchParams();
  for (const key of [...criteria, 'mode', 'page', 'selected']) if (next[key]) params.set(key, next[key]);
  return `/organizations/${organizationId}/work/dispatch?${params}`;
}

export const DISPATCH_ASSIGNMENTS = [
  ['', 'All active work'], ['scheduled', 'Today / selected day'],
  ['unassigned', 'Unassigned scheduled'], ['unscheduled', 'Unscheduled'],
  ['upcoming', 'Upcoming · next 7 days'], ['shortfall', 'Required resources missing · day'],
  ['conflict', 'Availability conflicts · day'],
] as const;
