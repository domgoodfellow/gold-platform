/**
 * Personal settings: the signed-in person's identity and sign-in, owned by the user and never by
 * whichever business is selected (D45). This is the one place its addresses are written, so the
 * menu, the sidebar and the redirect from the retired `/account` cannot disagree.
 */
export const PERSONAL_SETTINGS_ROOT = '/settings/account';

export const PERSONAL_SECTIONS = [
  { key: 'profile', label: 'Profile', description: 'Your personal display name and verified email address.', path: PERSONAL_SETTINGS_ROOT },
  { key: 'security', label: 'Security & sign-in', description: 'Your password and how you sign in.', path: `${PERSONAL_SETTINGS_ROOT}/security` },
] as const;

export type PersonalSection = (typeof PERSONAL_SECTIONS)[number]['key'];

/**
 * `organizationId` is the business the person came from, carried only so Personal settings can
 * offer a way back. It is a hint, never authority: the page checks it against the caller's own
 * memberships before showing anything.
 */
export function personalSettingsHref(section: PersonalSection = 'profile', organizationId?: string | null): string {
  const path = PERSONAL_SECTIONS.find((entry) => entry.key === section)!.path;
  return organizationId ? `${path}?org=${encodeURIComponent(organizationId)}` : path;
}
