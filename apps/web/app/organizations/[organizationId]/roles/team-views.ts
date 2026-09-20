/**
 * Team's three sibling views, as a URL value rather than remembered state — the same reasoning
 * the Automations workspace's `?view=` rests on: a view that survives a reload, arrives with the
 * back button, and can be sent to somebody is a fact the server can read, not a client
 * component's memory.
 */
export const TEAM_VIEWS = ['members', 'invitations', 'roles'] as const;

export type TeamView = (typeof TEAM_VIEWS)[number];

/** A Team view's address. `members` is the bare route, so the default view has one URL. */
export function teamViewHref(organizationId: string, view: TeamView): string {
  const root = `/organizations/${organizationId}/roles`;
  return view === 'members' ? root : `${root}?view=${view}`;
}

/** Invalid or missing resolves to Members — never a 404 for a mistyped query string. */
export function resolveTeamView(raw: string | undefined): TeamView {
  return (TEAM_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as TeamView) : 'members';
}
