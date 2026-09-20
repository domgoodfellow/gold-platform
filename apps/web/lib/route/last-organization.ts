/**
 * The business somebody was last working in, so a sign-in lands them there instead of on a page
 * asking them to choose. Written by `proxy.ts` whenever an organization path is visited; read by
 * the landing decision (`landing.ts`).
 *
 * It is a hint and never authority: the landing checks it against the caller's own memberships, so
 * a cookie naming somebody else's business (or a business they have since left) simply falls
 * through to their first one. It holds an id and nothing else, and no destination — the
 * destination is `organizationHomeHref`, decided from the business's lifecycle (D53).
 *
 * Constants only, so the proxy bundle imports no request-scoped API from here.
 */
export const LAST_ORGANIZATION_COOKIE = 'gold.last-organization';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export const LAST_ORGANIZATION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: ONE_YEAR_SECONDS,
};
