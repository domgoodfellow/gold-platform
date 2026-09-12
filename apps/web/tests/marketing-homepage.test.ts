import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MARKETING = fileURLToPath(new URL('../app/(marketing)', import.meta.url));
const page = readFileSync(`${MARKETING}/page.tsx`, 'utf8');
const layout = readFileSync(`${MARKETING}/layout.tsx`, 'utf8');

describe('the homepage has one conversion priority', () => {
  it('uses the real workflow-review intake for every primary marketing action', () => {
    for (const source of [layout, page]) {
      const actions = source.match(/ButtonLink href="\/workflow-review"/g) ?? [];
      expect(actions.length).toBeGreaterThan(0);
    }
  });

  it('keeps self-service signup subordinate and login in the persistent header', () => {
    expect(layout).toMatch(/href="\/login"/);
    expect(page).toMatch(/Prefer to explore independently/);
    expect(page).toMatch(/href="\/sign-up"/);
    expect(page).not.toMatch(/ButtonLink href="\/sign-up"/);
  });
});

describe('the editorial page ships without page-wide client JavaScript', () => {
  it('is a Server Component and contains no local interaction state', () => {
    expect(page).not.toMatch(/^['"]use client['"];?/);
    expect(page).not.toContain('useState');
  });

  it('uses semantic sections, a single h1, and ordered implementation steps', () => {
    expect(page.match(/<h1\b/g)).toHaveLength(1);
    expect(page).toContain('<ol');
    expect(page).toContain('Understand the workflow');
    expect(page).toContain('Configure the business');
    expect(page).toContain('Review and launch');
    expect(page).toContain('Improve over time');
  });
});

describe('the page sells outcomes and only demonstrated behavior', () => {
  it('does not lead with implementation providers or internal architecture vocabulary', () => {
    for (const forbidden of [
      /\bStripe\b/i,
      /\bTwilio\b/i,
      /\bSupabase\b/i,
      /\bPostgres\b/i,
      /\bAnthropic\b/i,
      /\bkernel\b/i,
      /\bmilestone\b/i,
    ]) {
      expect(page).not.toMatch(forbidden);
    }
  });

  it('introduces no fabricated proof, prices, or performance claims', () => {
    for (const forbidden of [
      /trusted by/i,
      /testimonial/i,
      /guarantee/i,
      /\d+[,+]?\s*(customers|businesses|tenants)\b/i,
      /\$[\d,]+/,
      /% (faster|more|less)/i,
    ]) {
      expect(page).not.toMatch(forbidden);
    }
  });

  it('labels the product rendering as an example rather than tenant evidence', () => {
    expect(page).toContain('Example configuration');
  });
});

describe('search and answer engines receive visible, truthful structure', () => {
  it('declares route metadata and visible Organization/WebSite/WebPage structured data', () => {
    expect(page).toContain('export const metadata');
    expect(page).toContain("'Organization'");
    expect(page).toContain("'WebSite'");
    expect(page).toContain("'WebPage'");
    expect(page).toContain('application/ld+json');
  });

  it('does not claim ratings, offers, FAQs, or local-business facts that are not visible', () => {
    for (const type of ['AggregateRating', 'Offer', 'FAQPage', 'LocalBusiness']) {
      expect(page).not.toContain(`'@type': '${type}'`);
    }
  });
});
