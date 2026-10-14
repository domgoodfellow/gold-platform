import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A portal request is the customer a business sent a link to, resolved from a session the link was
 * exchanged for once — never from a value the browser sends. These are the rules that keep it so;
 * `portal.test.ts` proves what the database does, the browser journey proves the screen.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');

const ACTIONS = read('app/(public)/portal/actions.ts');
const PAGE = read('features/portal-access/portal-page.tsx');
const ROUTE = read('app/(public)/portal/[token]/route.ts');

describe('the link is exchanged once, where a cookie can be kept', () => {
  it('exchanges in a route handler, never while a page renders', () => {
    expect(ROUTE).toContain('exchangePortalLink');
    expect(PAGE).not.toMatch(/claimPortalInvite|exchangePortalLink|signInAnonymously/);
  });

  it('leaves the token behind: redirects to an address with no secret, and says no-referrer', () => {
    expect(ROUTE).toContain("new URL('/portal'");
    expect(ROUTE).toContain("'Referrer-Policy', 'no-referrer'");
    expect(ROUTE).toContain("'Cache-Control', 'no-store'");
  });

  it('keeps the portal credential away from a script on the page', () => {
    expect(read('lib/db/portal.ts')).toMatch(/httpOnly: true/);
  });

  it('refreshes the portal session in the proxy, in its own cookie', () => {
    expect(read('proxy.ts')).toMatch(/portal:\s*request\.nextUrl\.pathname === '\/portal'/);
    expect(read('lib/db/session.ts')).toContain('createPortalClient');
  });
});

describe('a portal operation takes its identity from the session', () => {
  it('uses the portal client and never the account client', () => {
    for (const source of [ACTIONS, PAGE]) {
      expect(source).toContain('getPortalDb');
      expect(source).not.toMatch(/from '@\/lib\/db\/server'/);
    }
  });

  it('does not accept a token, an organization or a customer from the browser', () => {
    expect(ACTIONS).not.toMatch(/input:\s*\{[^}]*(token|organizationId|customerId)/);
    expect(ACTIONS).not.toMatch(/formData\.get\('(token|organizationId|customerId)'\)/);
  });

  it('proves a portal session before every action does anything', () => {
    const actions = ACTIONS.split(/export async function /).slice(1);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    for (const action of actions) expect(action, action.slice(0, 40)).toContain('requirePortalRequestContext(db)');
  });

  it('shows a page only to a live portal session, with one answer for every way of not having one', () => {
    expect(PAGE).toContain('requirePortalRequestContext(db)');
    expect(PAGE).toContain("redirect('/portal/unavailable')");
  });

  it('never names an organization or a customer in the redirect from a payment', () => {
    expect(ACTIONS).toContain('/portal/payment-return');
    expect(ACTIONS).not.toMatch(/payment-return\?/);
  });
});

describe('a portal customer is not an organization member', () => {
  it('binds only an anonymous session, and leaves memberships out of it', () => {
    const migration = read('../../supabase/migrations/20261122000001_a_portal_session_ends_when_its_link_does.sql');
    expect(migration).toContain("'is_anonymous'");
    expect(migration).not.toMatch(/insert into public\.memberships/);
  });

  it('answers nothing for a revoked link or an expired exchange, from the one function every portal policy reads', () => {
    const migration = read('../../supabase/migrations/20261122000001_a_portal_session_ends_when_its_link_does.sql');
    expect(migration).toMatch(/create or replace function app\.current_external_customer\(\)[\s\S]*portal_expires_at > now\(\)[\s\S]*revoked_at is null/);
  });
});
