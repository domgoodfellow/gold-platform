import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * GOLD's own homepage, rebuilt to sell the product Slices 1–4 actually produced rather than the
 * architecture underneath it (product reality audit, Slice 4).
 *
 * Source scan throughout, for the reason every other marketing/navigation suite here gives:
 * this repository runs no harness that mounts a server component, and the claims below are
 * about which words and links a file contains, not about anything a browser computes.
 */

const MARKETING = fileURLToPath(new URL('../app/(marketing)', import.meta.url));
const page = readFileSync(`${MARKETING}/page.tsx`, 'utf8');
const layout = readFileSync(`${MARKETING}/layout.tsx`, 'utf8');

describe('the primary CTA is a workflow review, not self-service signup', () => {
  it('leads with "Request a workflow review" in both the header and the hero', () => {
    expect(layout).toContain('Request a workflow review');
    expect(page).toContain('Request a workflow review');
  });

  it('does not point the primary action at /sign-up', () => {
    // The header's primary button specifically — not a blanket ban on the string "/sign-up",
    // since a subordinate link to it is exactly what this slice asks for elsewhere on the page.
    const primaryButton = layout.match(/ButtonLink href="[^"]*"[^>]*tone="primary"/)?.[0] ?? '';
    expect(primaryButton).not.toContain('/sign-up');
  });

  it('points every "Request a workflow review" button at the real intake route', () => {
    // Slice 5: the button used to scroll to an in-page anchor with no submission mechanism
    // behind it. Every instance now leads to the form that actually writes something.
    for (const source of [layout, page]) {
      const buttons = source.match(/ButtonLink href="[^"]*"[^>]*>\s*Request a workflow review/g) ?? [];
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button).toContain('href="/workflow-review"');
      }
    }
  });
});

describe('Log in remains available', () => {
  it('is reachable from the header', () => {
    expect(layout).toMatch(/href="\/login"/);
  });

  it('is reachable from the hero', () => {
    expect(page).toMatch(/href="\/login"/);
  });
});

describe('self-service signup remains reachable but subordinate', () => {
  it('links to /sign-up, worded as exploring rather than the primary offer', () => {
    expect(page).toMatch(/href="\/sign-up"/);
    expect(page).toMatch(/explore on your own/i);
  });

  it('is not styled as a primary button anywhere on the page', () => {
    // A ButtonLink or Button with tone="primary" pointed at /sign-up would be the two-equal-CTAs
    // mistake this slice exists to remove.
    expect(page).not.toMatch(/tone="primary"[^>]*href="\/sign-up"/);
    expect(page).not.toMatch(/href="\/sign-up"[^>]*tone="primary"/);
  });
});

describe('internal commercial strategy does not appear in customer-facing copy', () => {
  it('carries none of the internal sequencing language', () => {
    const forbidden = [
      /buy this three times/i,
      /first sale/i,
      /second sale/i,
      /third sale/i,
      /upsell/i,
      /80.{0,3}15.{0,3}5/,
    ];
    for (const pattern of forbidden) {
      expect(page, `found forbidden pattern: ${pattern}`).not.toMatch(pattern);
    }
  });

  it('carries none of the internal architecture vocabulary', () => {
    const forbidden = [/\bkernel\b/i, /\bengine\b/i, /\bmodule(s)?\b/i, /\bmilestone\b/i];
    for (const pattern of forbidden) {
      expect(page, `found forbidden pattern: ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('configured implementation is explained', () => {
  it('names the real four-step motion', () => {
    expect(page).toContain('Understand the workflow');
    expect(page).toContain('Configure the business');
    expect(page).toContain('Review and launch');
    expect(page).toContain('Improve over time');
  });

  it('does not claim implementation is instant or promise a specific duration', () => {
    expect(page).not.toMatch(/instant(ly)?/i);
    expect(page).not.toMatch(/\b\d+\s*(hours?|days?|weeks?)\b/i);
  });

  it('describes Launch as a deliberate decision, not automatic', () => {
    expect(page).toMatch(/launch(ing)? .{0,40}(decision|deliberate|ready)/i);
  });
});

describe('the product example uses real GOLD concepts', () => {
  it('names actual areas rather than invented or generic SaaS labels', () => {
    for (const label of ['Today', 'Work', 'Schedule', 'Customers', 'Settings']) {
      expect(page).toContain(`label: '${label}'`);
    }
  });

  it('names the real Today widgets from Slice 2, not invented ones', () => {
    expect(page).toContain('Committed today');
    expect(page).toContain('Waiting to be scheduled');
    expect(page).toContain('Recent activity');
  });

  it('is labelled as one example, not a claim about every tenant', () => {
    expect(page).toMatch(/Example:.*configured in GOLD/);
    expect(page).toMatch(/one example business/i);
  });

  it('says the screens are fixed and only the data inside them varies (D6)', () => {
    // The area/screen labels are the platform's words, not a tenant's — only a tenant's own
    // data (their customers, jobs, work types and statuses) is theirs to vary. An earlier
    // draft of this sentence read as a promise that a tenant could rename these screens, which
    // nothing in this repository builds.
    expect(page).toMatch(/screens stay the same/i);
    expect(page).not.toMatch(/the areas, the words/i);
  });
});

describe('no fabricated proof is introduced', () => {
  it('makes no customer-count, revenue, testimonial or guarantee claims', () => {
    const forbidden = [
      /\d+[,+]?\s*(customers|businesses|tenants)\b/i,
      /testimonial/i,
      /guarantee/i,
      /trusted by/i,
      /\$[\d,]+/,
      /% (faster|more|less)/i,
    ];
    for (const pattern of forbidden) {
      expect(page, `found forbidden pattern: ${pattern}`).not.toMatch(pattern);
    }
  });
});

describe('rendered integration names are real', () => {
  it('every vendor named in BUILT_ON has an actual integration in apps/api', () => {
    const match = page.match(/const BUILT_ON = \[([^\]]+)\]/);
    expect(match, 'BUILT_ON list not found').not.toBeNull();

    const names = (match![1].match(/'([^']+)'/g) ?? []).map((entry) => entry.slice(1, -1));
    expect(names.length).toBeGreaterThan(0);

    const integrationsDir = fileURLToPath(new URL('../../api/app/integrations', import.meta.url));
    const present = new Set(readdirSync(integrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.toLowerCase()));

    for (const name of names) {
      expect(present.has(name.toLowerCase()), `${name} has no directory under apps/api/app/integrations`).toBe(
        true,
      );
    }
  });

  it('keeps the integration strip visually subordinate, not the principal proof', () => {
    // Placed after the capability and implementation sections — late in the page, not the
    // first thing a visitor sees — and in the same small, muted styling it always used.
    const capabilitiesIndex = page.indexOf('id="capabilities"');
    const builtOnIndex = page.indexOf('Built on');
    expect(capabilitiesIndex).toBeGreaterThan(-1);
    expect(builtOnIndex).toBeGreaterThan(capabilitiesIndex);

    const nearby = page.slice(Math.max(0, builtOnIndex - 200), builtOnIndex);
    expect(nearby, 'the "Built on" label should still be small, muted text').toContain(
      'text-subtle',
    );
  });
});

describe('the page carries no tenant voice or tenant data (GOLD speaks only for itself)', () => {
  it('never renders a SiteShell action attributed to a tenant', () => {
    // Already exhaustively proven by `public-profile.test.ts` for the whole `(marketing)` and
    // `(public)` boundary; this narrows to the one new claim this slice adds — the product
    // example is explicitly fictional, not a real business's own words.
    expect(page).not.toMatch(/organization\.(name|slug)/);
    expect(page).toMatch(/example business|this example/i);
  });
});
