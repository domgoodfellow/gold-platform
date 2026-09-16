/**
 * The Automations workspace's three sibling views, as a URL value rather than remembered state —
 * the same reasoning `?widget=` and `?dashboard=` already rest on (`ui-spec.md` §2b): a view that
 * survives a reload, arrives with the back button, and can be sent to somebody is a fact the
 * server can read, not a client component's memory.
 */
export const AUTOMATIONS_VIEWS = ['rules', 'messages', 'activity'] as const;

export type AutomationsView = (typeof AUTOMATIONS_VIEWS)[number];

/** Invalid or missing resolves to Rules — never a 404 for a mistyped query string. */
export function resolveAutomationsView(raw: string | undefined): AutomationsView {
  return (AUTOMATIONS_VIEWS as readonly string[]).includes(raw ?? '')
    ? (raw as AutomationsView)
    : 'rules';
}
