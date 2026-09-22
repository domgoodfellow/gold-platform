/**
 * The Automations workspace's three pages. They are routes now; the old view query survives only so an old
 * address can be sent to the page that replaced it.
 */
export const AUTOMATIONS_VIEWS = ['rules', 'messages', 'activity'] as const;

export type AutomationsView = (typeof AUTOMATIONS_VIEWS)[number];

/** Invalid or missing resolves to Rules — never a 404 for a mistyped query string. */
export function resolveAutomationsView(raw: string | undefined): AutomationsView {
  return (AUTOMATIONS_VIEWS as readonly string[]).includes(raw ?? '')
    ? (raw as AutomationsView)
    : 'rules';
}
