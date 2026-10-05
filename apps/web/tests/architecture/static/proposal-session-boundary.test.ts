import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A proposal request is the recipient a business sent one link to, resolved from a session the
 * link was exchanged for once — never from a value the browser sends. These keep it so;
 * `proposal-access.test.ts` proves what the database does.
 */

const WEB = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(`${WEB}/${path}`, 'utf8');

const ACTIONS = read('app/(public)/proposal/actions.ts');
const PAGE = read('app/(public)/proposal/page.tsx');
const FORM = read('app/(public)/proposal/respond-form.tsx');
const ROUTE = read('app/(public)/proposal/[token]/route.ts');

describe('the proposal link is exchanged once, where a cookie can be kept', () => {
  it('exchanges in a route handler, never while a page renders', () => {
    expect(ROUTE).toContain('exchangeProposalLink');
    expect(PAGE).not.toMatch(/claimProposalInvite|exchangeProposalLink|signInAnonymously/);
  });

  it('leaves the token behind: redirects to an address with no secret, no-store and no-referrer', () => {
    expect(ROUTE).toContain("new URL('/proposal'");
    expect(ROUTE).toContain("'Referrer-Policy', 'no-referrer'");
    expect(ROUTE).toContain("'Cache-Control', 'no-store'");
  });

  it('is reachable with no session, and refreshes only its own cookie', () => {
    expect(read('lib/route/access.ts')).toContain("PROPOSAL_PREFIX = '/proposal/'");
    expect(read('proxy.ts')).toMatch(/proposal:\s*request\.nextUrl\.pathname === '\/proposal'/);
    expect(read('lib/db/session.ts')).toContain('createProposalClient');
  });
});

describe('a proposal session is its own, and ends no other', () => {
  const proposal = read('lib/db/proposal.ts');

  it('has a cookie of its own, HttpOnly, scoped to /proposal', () => {
    expect(proposal).toContain("PROPOSAL_COOKIE_NAME = 'gold-proposal'");
    expect(proposal).toContain("PROPOSAL_COOKIE_PATH = '/proposal'");
    expect(proposal).toMatch(/httpOnly: true/);
    expect(proposal).toContain('cookieOptions: { name: PROPOSAL_COOKIE_NAME }');
  });

  it('is never read by the account or portal clients, and never reads theirs', () => {
    for (const file of ['lib/db/server.ts', 'lib/db/portal.ts', 'lib/db/portal-server.ts']) {
      expect(read(file), file).not.toMatch(/gold-proposal|PROPOSAL_COOKIE|createProposalClient/);
    }
    expect(proposal).not.toMatch(/gold-portal|PORTAL_COOKIE/);
    expect(read('lib/domain/portal/context.ts')).not.toMatch(/proposal/i);
  });

  it('ends sessions locally only, and only in the exchange', () => {
    const access = read('lib/domain/customers/proposal-access.ts');
    expect(access).toMatch(/signOut\(\{ scope: 'local' \}\)/);
    expect(access).not.toMatch(/signOut\(\)/);
    expect(ROUTE).toContain('createProposalClient');
    for (const source of [ACTIONS, PAGE, FORM]) expect(source).not.toMatch(/signOut/);
  });
});

describe('a proposal decision takes its identity from the session', () => {
  it('uses the proposal client and never the account client', () => {
    for (const source of [ACTIONS, PAGE]) {
      expect(source).toContain('getProposalDb');
      expect(source).not.toMatch(/from '@\/lib\/db\/server'/);
    }
  });

  it('does not accept a token, an organization or a customer from the browser', () => {
    for (const source of [ACTIONS, FORM]) {
      expect(source).not.toMatch(/formData\.get\('(token|organizationId|customerId|status)'\)/);
      expect(source).not.toMatch(/name="(token|organizationId|customerId|status)"/);
    }
    expect(FORM).not.toMatch(/token/);
  });

  it('proves a proposal session before every action does anything', () => {
    const actions = ACTIONS.split(/export async function /).slice(1);
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action, action.slice(0, 40)).toContain('requireProposalAccessContext(db)');
  });

  it('shows a page only to a live proposal session, with one answer for every way of not having one', () => {
    expect(PAGE).toContain('proposalAccessContext(db)');
    expect(PAGE).toContain("redirect('/proposal/unavailable')");
  });
});

describe('a proposal recipient is not an organization member', () => {
  const migration = read('../../supabase/migrations/20261124000001_a_proposal_session_ends_when_its_link_does.sql');

  it('binds only an anonymous session, and leaves memberships out of it', () => {
    expect(migration).toContain("'is_anonymous'");
    expect(migration).not.toMatch(/insert into public\.memberships/);
  });

  it('decides each response under a row lock, against the exact version shown', () => {
    expect(migration.match(/for update;/g)).toHaveLength(2);
    expect(migration).toContain('has been replaced by a newer version');
  });

  it('answers nothing for a revoked link or an expired exchange, from the one function every external policy reads', () => {
    expect(migration).toMatch(/create or replace function app\.current_external_customer\(\)[\s\S]*proposal_expires_at > now\(\)[\s\S]*revoked_at is null/);
  });
});
