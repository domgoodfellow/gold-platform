import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { publicProfile, setPublicProfile } from '@/lib/domain/tenancy/profile';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from './helpers/founding';
import { type Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * A business's own words, and the rule that made this exist.
 *
 * `constraints.md`: "Never hardcode a claim a business makes about itself — guarantees, trust
 * points, service assertions, section headings. Copy is configuration." The booking surface
 * shipped saying "Book a time" and "This business is not taking bookings online at the moment"
 * on a URL a business puts on the side of a van, which is the platform speaking in that
 * business's voice.
 *
 * D20 defers the marketing surface for exactly that reason and then permits booking — which is
 * a public page. The two are one problem, and the second arrived first.
 *
 * The last test in this file is the one that matters most: it reads the public route's source
 * and fails on a hardcoded sentence. Everything else here can be satisfied by a careful author;
 * that one survives a careless one.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = { db: SupabaseClient; organizationId: string; name: string };

let pneu: Tenant;

async function signUp(label: string) {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, email };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, email } = await signUp(label);
  const name = `${label} Ltd`;
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name,
    displayName: 'Owner',
    timezone: 'America/Toronto',
    currency: 'CAD',
  });
  return { db, organizationId, name };
}

async function member(tenant: Tenant, label: string, capabilities: Capability[]) {
  const { db, email } = await signUp(label);
  const roleId = await createRole(tenant.db, {
    organizationId: tenant.organizationId,
    name: label,
    capabilities,
  });
  await addMember(tenant.db, {
    organizationId: tenant.organizationId,
    email,
    displayName: label,
    roleId,
  });
  return db;
}

describe('what a business says about itself', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    pneu = await newTenant('pp-pneu');
  });

  it('says nothing at all until the business does', async () => {
    // No seeded tagline, no "Welcome to", no placeholder. The same reading of silence that
    // operating hours and the buffer take: absence is not an invitation to invent.
    const profile = await publicProfile(pneu.db, {
      organizationId: pneu.organizationId,
      fallbackName: pneu.name,
    });

    expect(profile).toEqual({
      displayName: pneu.name,
      tagline: null,
      intro: null,
      contactEmail: null,
      contactPhone: null,
      address: null,
    });
  });

  it('falls back to the business’s own name, never to the platform’s words', async () => {
    // The floor matters more than the fields. A business that configures nothing must still
    // render *its* name — "it has said nothing" must not become the platform saying something
    // on its behalf.
    const profile = await publicProfile(pneu.db, {
      organizationId: pneu.organizationId,
      fallbackName: pneu.name,
    });
    expect(profile.displayName).toBe(pneu.name);
  });

  it('stores the business’s own words', async () => {
    await setPublicProfile(pneu.db, {
      organizationId: pneu.organizationId,
      displayName: 'Pneu3L',
      tagline: 'On vient à vous — service de pneus mobile à Montréal',
      intro: 'Nous remplaçons vos pneus chez vous ou au bureau.',
      contactEmail: 'allo@pneu3l.test',
      contactPhone: '+1 514 555 0100',
      address: 'Montréal, QC',
    });

    const profile = await publicProfile(pneu.db, {
      organizationId: pneu.organizationId,
      fallbackName: pneu.name,
    });
    expect(profile.displayName).toBe('Pneu3L');
    expect(profile.tagline).toContain('Montréal');
    expect(profile.contactPhone).toBe('+1 514 555 0100');
  });

  it('treats an emptied field as unset rather than empty', async () => {
    // Clearing a tagline is a decision. Storing '' would render a blank line where the reader
    // expects nothing at all, which is the platform putting something on the page again.
    await setPublicProfile(pneu.db, {
      organizationId: pneu.organizationId,
      displayName: 'Pneu3L',
      tagline: '   ',
      intro: '',
      contactEmail: '',
      contactPhone: '+1 514 555 0100',
      address: '',
    });

    const profile = await publicProfile(pneu.db, {
      organizationId: pneu.organizationId,
      fallbackName: pneu.name,
    });
    expect(profile.tagline).toBeNull();
    expect(profile.intro).toBeNull();
    expect(profile.contactPhone).toBe('+1 514 555 0100');
  });

  it('is settings, not a new authority', async () => {
    // No `profile.manage`. `organization.manage` already means "change this business's own
    // settings", and a capability with no operation distinct from another is vocabulary
    // nobody can act on differently.
    const outsider = await member(pneu, 'pp-clerk', ['work_item.create']);

    await expect(
      setPublicProfile(outsider, {
        organizationId: pneu.organizationId,
        displayName: 'Hijacked',
        tagline: '',
        intro: '',
        contactEmail: '',
        contactPhone: '',
        address: '',
      }),
    ).rejects.toMatchObject({ code: 'profile.forbidden' });

    const profile = await publicProfile(pneu.db, {
      organizationId: pneu.organizationId,
      fallbackName: pneu.name,
    });
    expect(profile.displayName).toBe('Pneu3L');
  });

  it('shows one tenant nothing of another’s', async () => {
    const rival = await newTenant('pp-rival');
    const { data } = await rival.db
      .from('organization_profiles')
      .select('display_name')
      .eq('organization_id', pneu.organizationId);
    expect(data).toEqual([]);
  });

  it('keeps the platform out of a business’s voice, in the source itself', () => {
    // **The assertion that survives a careless author.** Everything above can be satisfied by
    // somebody who remembers the rule; this fails if they forget it and add a sentence to the
    // public page. It reads the route's own source and looks for prose that is not application
    // state — `constraints.md` carves out "Loading", "No results" and aria labels, and nothing
    // else.
    // Comments are stripped first, and that is deliberate rather than a loophole. The pages
    // *document* the sentences they used to carry — a test that forbade explaining the rule
    // would push the reasoning out of the file it governs, which is the opposite of what this
    // repository does everywhere else. What is scanned is what could reach a reader.
    const withoutComments = (source: string) =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    // Under `(public)` since the route groups landed. That group is a tenant's own customers;
    // `(marketing)` is GOLD speaking for itself and is deliberately not scanned here — see
    // that page, and D20, which had been using one word for both.
    //
    // **Every file under the group, found by walking it — not a list.** This was two paths
    // written out by hand, which meant the guard covered the two files somebody remembered and
    // nothing else: the customer portal renders the same header and was never scanned at all,
    // and the first `loading.tsx` added to the booking route would have been outside it too.
    // A guard whose reach depends on a later author remembering to extend it is a guard for
    // careful authors, and this file's own docblock claims the opposite.
    const group = fileURLToPath(new URL('../app/(public)', import.meta.url));

    const sourcesUnder = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const full = `${directory}/${entry.name}`;
        if (entry.isDirectory()) return sourcesUnder(full);
        return entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')
          ? [withoutComments(readFileSync(full, 'utf8'))]
          : [];
      });

    const routes = sourcesUnder(group);

    // A guard that scans nothing passes silently, which is the one way this could rot without
    // anybody noticing. The count is not asserted — files come and go — but emptiness is.
    expect(routes.length).toBeGreaterThan(0);

    // Phrases that speak *for* a business rather than about the system. Each was on the page
    // before this slice existed, which is why they are the examples.
    const forbidden = [
      'Book a time',
      'not taking bookings online',
      'will be in touch',
      'Welcome',
      'Book with',
    ];

    for (const source of routes) {
      for (const phrase of forbidden) {
        expect(source, `a public page must not say "${phrase}" on a business's behalf`).not.toContain(
          phrase,
        );
      }
    }
  });
});

describe("GOLD's chrome, and the one place it must never appear", () => {
  /**
   * `SiteShell` (credential screens) and `MarketingShell` (the marketing site) are each a header
   * saying GOLD and a footer saying GOLD. On those pages that is correct — the business making claims there is GOLD.
   *
   * On `/book/{slug}` and `/portal/{token}` it would be our wordmark on somebody else's shop
   * front. That is the same failure the rest of this file guards against, in structural form
   * rather than as a sentence: a customer of a business must meet that business, and D20 keeps
   * the platform out of the frame entirely.
   */
  const sourcesIn = (relative: string): string[] => {
    const root = fileURLToPath(new URL(`../app/${relative}`, import.meta.url));
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith('.tsx') ? [readFileSync(full, 'utf8')] : [];
      });
    return walk(root);
  };

  it('dresses GOLD’s own pages in it', () => {
    // Both, because the point of the shell is that the two stop feeling like two applications.
    for (const [group, shell] of [['(marketing)', 'MarketingShell'], ['(auth)', 'SiteShell']] as const) {
      const uses = sourcesIn(group).some((source) => source.includes(shell));
      expect(uses, `${group} should render inside ${shell}`).toBe(true);
    }
  });

  it("keeps it off a tenant's own surfaces", () => {
    const offenders = sourcesIn('(public)').filter((source) => /SiteShell|MarketingShell|MarketingHeader|MarketingFooter/.test(source));
    expect(offenders).toEqual([]);
  });
});
