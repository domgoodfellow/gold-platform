import type { SessionCheck } from '@/lib/domain/identity/session';

/**
 * Routes reachable without a session. Everything else redirects to the log-in screen.
 *
 * This is a closed set, checked by exact match or path prefix — not a pattern a request
 * can talk its way into. The redirect target below is likewise a fixed literal: there is
 * deliberately no `?next=` parameter, because a stored destination would have to resolve
 * against a closed set on read as well as on write, and nothing needs one yet
 * (`docs/security.md`: never build an open redirector).
 *
 * Pulled out of `proxy.ts` itself (which otherwise pulls in `next/server`) so this stays plain
 * TypeScript with no Next.js runtime import — `session-identity.test.ts` calls `decideRedirect`
 * directly, with no `NextRequest` or real session needed to exercise it.
 */
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/sign-up',
  '/verify-email',
  '/auth/confirm',
  '/forgot-password',
  // GOLD's own marketing site: the three product pages, how it works, integrations, pricing,
  // the demo request itself, contact, and the two legal pages — same public standing as the four screens above. A visitor
  // arrives with no session, and `/demo`'s and `/contact`'s `submitPublicInquiry` gives them a one-shot
  // anonymous one for exactly as long as the single privileged write takes.
  '/sales',
  '/operations',
  '/customer-service',
  '/how-it-works',
  '/integrations',
  '/pricing',
  '/demo',
  '/contact',
  '/privacy',
  '/terms',
  // Where a recovery link lands, and the screen it lands on. Both have to be reachable without a
  // session: that is the state somebody who has forgotten their password is in. `/auth/recover`
  // is a route handler that exchanges the code for one, and `/reset-password` turns an arriving
  // caller with no session away itself.
  '/auth/recover',
  '/reset-password',
  // Where a Google sign-in lands. Same standing as `/auth/recover`: reachable with no session,
  // because arriving here with one is the point.
  '/auth/callback',
  // Email confirmation establishes the session; it must be reachable before sign-in.
  '/auth/email-change',
];

/**
 * The booking surface, which is public in a way the paths above are not.
 *
 * A prefix rather than an exact match, because the organization and the booking are in the
 * path — and it stays a closed set: one literal, checked with its trailing delimiter so that
 * `/booking` or `/book-a-thing` cannot talk their way in.
 *
 * Letting these through is not an authorization decision and nothing here decides anything. A
 * visitor arrives with no session at all; `beginBooking` gives them an anonymous one, and
 * every row they can then reach is decided by an RLS policy keyed to
 * `app.current_external_tenant()`. If this line were deleted the surface would be unreachable
 * and still correct, which is exactly what the redirect below is also true of.
 */
const BOOKING_PREFIX = '/book/';

/**
 * The portal, on the same terms as booking.
 *
 * The token in the path is a credential, and it is checked by `claim_portal_invite` against a
 * row rather than by anything here -- this only declines to redirect a caller who has no
 * session yet, because they are about to be given an anonymous one. A stranger reaching this
 * prefix with an invented token gets a 404 from the page, not access.
 */
const PORTAL_PREFIX = '/portal/';
/** The address a link is exchanged for, which carries no secret: the portal's own home. */
const PORTAL_HOME = '/portal';

/**
 * A proposal link, on the same terms as the portal: the token in the path is a credential checked
 * by `claim_proposal_invite` against a row, exchanged once for a session in the proposal's own
 * cookie and left behind at `/proposal`, which carries no secret. This only declines to redirect a
 * caller who has no session yet.
 */
const PROPOSAL_PREFIX = '/proposal/';
const PROPOSAL_HOME = '/proposal';

/**
 * A business's published form, on the same terms as booking: the organization and form are named
 * by slug in the path, `published_form` answers only for a published one, and a visitor gets an
 * anonymous session for exactly the length of one submission. Nothing here decides anything.
 */
const FORMS_PREFIX = '/forms/';

/** A form's stable address, and the frameable fragment other sites embed. Same terms as `/forms/`. */
const FORM_KEY_PREFIX = '/f/';
const EMBED_PREFIX = '/embed/';

/**
 * Accepting an organization invitation, on the same terms as booking and the portal.
 *
 * The token in the path is the credential, checked by `accept_invitation` against a row — not by
 * anything here. This only declines to redirect a signed-out invitee away before the page can
 * greet them with a sign-in/sign-up prompt; a stranger reaching this prefix with an invented
 * token gets the page's own "not valid" refusal, not access to anything.
 */
const ACCEPT_INVITE_PREFIX = '/organizations/accept-invite/';

export function isPublic(pathname: string): boolean {
  return (
    (process.env.NODE_ENV === 'development' && pathname === '/dev/design-system') ||
    // Browser-harness identity check; the route answers 404 unless the caller holds the instance token.
    (process.env.NODE_ENV !== 'production' && pathname === '/api/e2e/instance') ||
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith(BOOKING_PREFIX) ||
    pathname === PORTAL_HOME ||
    pathname.startsWith(PORTAL_PREFIX) ||
    pathname === PROPOSAL_HOME ||
    pathname.startsWith(PROPOSAL_PREFIX) ||
    pathname.startsWith(FORMS_PREFIX) ||
    pathname.startsWith(FORM_KEY_PREFIX) ||
    pathname.startsWith(EMBED_PREFIX) ||
    pathname.startsWith(ACCEPT_INVITE_PREFIX)
  );
}

/**
 * Where to send somebody, or `null` to let the request through as-is.
 *
 * `'account'` is the only identity that counts as genuinely signed in here: an anonymous
 * Supabase session (the anonymous-session model — booking, the portal) is real for RLS but must not be treated as an
 * operator/organization identity, so it is redirected to `/login` exactly like no session at
 * all — and, unlike an anonymous session before this, must still be able to *reach* `/login`
 * and `/sign-up` rather than being bounced away from them the way a genuine account is.
 *
 * `'unverified'` (the sign-in service could not be asked) goes through unchanged: the person may
 * well be signed in, and the page's `requireActor` shows the service error with Try again.
 */
export function decideRedirect(identity: SessionCheck, pathname: string): string | null {
  if (identity.kind === 'unverified') return null;

  if (identity.kind !== 'account' && !isPublic(pathname)) {
    return '/login';
  }

  if (identity.kind === 'account' && (pathname === '/login' || pathname === '/sign-up')) {
    return '/organizations';
  }

  return null;
}
