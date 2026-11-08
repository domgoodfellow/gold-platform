import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MARKETING = fileURLToPath(new URL('../../../app/(marketing)', import.meta.url));
const page = readFileSync(`${MARKETING}/page.tsx`, 'utf8');
const layout = readFileSync(`${MARKETING}/layout.tsx`, 'utf8');
const renderer = readFileSync(fileURLToPath(new URL('../../../features/public-site/section-renderers.tsx', import.meta.url)), 'utf8');
const nav = readFileSync(fileURLToPath(new URL('../../../components/marketing/marketing-nav.tsx', import.meta.url)), 'utf8');
// The seed the current section content actually comes from — the base migration's own copy of
// `app.default_gold_homepage_sections()` is superseded by `create or replace` here, the same way
// the running database is.
const publishing = readFileSync(fileURLToPath(new URL('../../../../../supabase/migrations/20260927000001_gold_homepage_sells_three_products.sql', import.meta.url)), 'utf8');

describe('the homepage has one conversion priority', () => {
  it('uses the real demo intake for every primary marketing action', () => {
    expect(nav).toMatch(/ButtonLink href="\/demo"/);
    expect(publishing).toContain('"href":"/demo"');
  });

  it('keeps self-service signup subordinate and login in the persistent header', () => {
    expect(nav).toMatch(/href="\/login"/);
    expect(publishing).toMatch(/Prefer to explore independently/);
    expect(publishing).toContain('"href":"/sign-up"');
  });

  it('does not surface the old workflow-review route anywhere in primary marketing chrome', () => {
    expect(layout + nav + page).not.toMatch(/workflow-review/i);
    expect(layout + nav + page).not.toMatch(/Request a workflow review/i);
  });
});

describe('the editorial page ships without page-wide client JavaScript', () => {
  it('keeps both the public route and shared renderer as Server Components', () => {
    expect(page).not.toMatch(/^['"]use client['"];?/);
    expect(renderer).not.toMatch(/^['"]use client['"];?/);
    expect(page + renderer).not.toContain('useState');
  });

  it('uses semantic sections, a single h1, and ordered implementation steps', () => {
    expect(renderer.match(/<h1\b/g)).toHaveLength(1);
    expect(renderer).toContain('<ol');
    for (const text of ['See how you work today', 'Configure your workspace', 'Review and launch', 'Improve over time']) {
      expect(publishing).toContain(text);
    }
  });

  it('names the three commercial products, each linking to its own page', () => {
    for (const [title, href] of [['Sales', '/sales'], ['Operations', '/operations'], ['Customer Service', '/customer-service']] as const) {
      expect(publishing).toContain(title);
      expect(renderer).toContain(href);
    }
    // "Capabilities" is gone from the public vocabulary — this is a products door, not a feature dump.
    expect(renderer).not.toMatch(/>\s*Capabilities\s*</);
  });
});

describe('the page sells outcomes and only demonstrated behavior', () => {
  it('does not lead with providers or internal architecture vocabulary', () => {
    for (const forbidden of [/\bStripe\b/i, /\bTwilio\b/i, /\bSupabase\b/i, /\bPostgres\b/i, /\bAnthropic\b/i, /\bkernel\b/i, /\bmilestone\b/i]) {
      expect(page + renderer).not.toMatch(forbidden);
    }
  });

  it('does not read like internal architecture documentation', () => {
    for (const forbidden of [/control stays explicit/i, /one foundation/i, /tenant boundary/i, /configure the operation/i, /automate deliberately/i]) {
      expect(publishing).not.toMatch(forbidden);
    }
  });

  it('introduces no fabricated proof, prices, or performance claims', () => {
    for (const forbidden of [/trusted by/i, /testimonial/i, /guarantee/i, /\d+[,+]?\s*(customers|businesses|tenants)\b/i, /\$[\d,]+/, /% (faster|more|less)/i]) {
      expect(renderer).not.toMatch(forbidden);
    }
  });

  it('labels the product rendering as an example rather than tenant evidence', () => {
    expect(renderer).toContain('Example setup');
  });
});

describe('search and answer engines receive visible, truthful structure', () => {
  it('derives route metadata and visible structured data from the published projection', () => {
    expect(page).toContain('generateMetadata');
    expect(page).toContain("'Organization'");
    expect(page).toContain("'WebSite'");
    expect(page).toContain("'WebPage'");
    expect(page).toContain('application/ld+json');
    expect(page).toContain('site.seoTitle');
  });

  it('does not claim ratings, offers, FAQs, or local-business facts that are not visible', () => {
    for (const type of ['AggregateRating', 'Offer', 'FAQPage', 'LocalBusiness']) expect(page).not.toContain(`'@type': '${type}'`);
  });
});
