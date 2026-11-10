import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WebsiteSectionSchema } from '@gold/schemas';
import { OFFERINGS, OFFERING_GROUPS } from '@/lib/marketing/content';

const MARKETING = fileURLToPath(new URL('../../../app/(marketing)', import.meta.url));
const MIGRATIONS = fileURLToPath(new URL('../../../../../supabase/migrations', import.meta.url));
const page = readFileSync(`${MARKETING}/page.tsx`, 'utf8');
const layout = readFileSync(`${MARKETING}/layout.tsx`, 'utf8');
const renderer = readFileSync(fileURLToPath(new URL('../../../features/public-site/section-renderers.tsx', import.meta.url)), 'utf8');
const nav = readFileSync(fileURLToPath(new URL('../../../components/marketing/marketing-nav.tsx', import.meta.url)), 'utf8');

/**
 * The homepage's sections come from the latest migration that defines
 * `app.default_gold_homepage_sections()`: each one supersedes the last with `create or replace`,
 * the same way the running database does. Read the latest, not a fixed file name, so this test
 * follows the seed rather than a copy it replaced.
 */
const seedFile = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .filter((file) => readFileSync(`${MIGRATIONS}/${file}`, 'utf8').includes('function app.default_gold_homepage_sections()'))
  .at(-1)!;
const publishing = readFileSync(`${MIGRATIONS}/${seedFile}`, 'utf8');
const seededSections = JSON.parse(/select \$json\$([\s\S]*?)\$json\$::jsonb/.exec(publishing)![1]!) as Record<string, unknown>[];
const sections = seededSections.map((section) => WebsiteSectionSchema.parse({ ...section, id: '00000000-0000-4000-8000-000000000000' }));

describe('the homepage has one conversion priority', () => {
  it('uses the real demo intake for every primary marketing action', () => {
    expect(nav).toMatch(/ButtonLink href="\/demo"/);
    for (const section of sections) {
      if (section.kind === 'hero' || section.kind === 'cta') expect(section.primaryCta.href).toBe('/demo');
    }
  });

  it('keeps login in the persistent header', () => {
    expect(nav).toMatch(/href="\/login"/);
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
    expect(sections.filter((section) => section.kind === 'hero')).toHaveLength(1);
    expect(sections.some((section) => section.kind === 'process')).toBe(true);
  });
});

describe('the homepage presents products the way a visitor can buy them', () => {
  const groups = sections.filter((section) => section.kind === 'capabilities');

  it('is a valid website, judged by the same schema Studio and the database use', () => {
    expect(sections.length).toBe(seededSections.length);
  });

  it('shows tools on their own, AI and automation, and connected applications, as linked lists', () => {
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      expect(group.variant).toBe('list');
      for (const item of group.items) expect(item.href, item.title).toBeTruthy();
    }
    const titles = groups.flatMap((group) => group.items.map((item) => item.title));
    for (const name of ['Dialer', 'AI receptionist', 'Workflow automation', 'Sales', 'Operations', 'Customer Service']) {
      expect(titles).toContain(name);
    }
  });

  it('links every product row to a page that exists, or to an entry on /products', () => {
    const anchors = new Set([...OFFERINGS.map((offering) => offering.id), ...OFFERING_GROUPS.map((group) => group.key)]);
    const links = [
      ...groups.flatMap((group) => group.items.map((item) => item.href!)),
      ...sections.flatMap((section) => ('secondaryCta' in section && section.secondaryCta ? [section.secondaryCta.href] : [])),
    ];
    for (const href of links) {
      const [path, anchor] = href.split('#');
      expect(existsSync(`${MARKETING}${path}/page.tsx`), `${href} has no page`).toBe(true);
      if (anchor) {
        expect(path, href).toBe('/products');
        expect(anchors.has(anchor), `${href} names no product`).toBe(true);
      }
    }
  });

  it('leaves links to the content, never guessed from a card title in the shared renderer', () => {
    // A business's website is drawn by the same renderer: a card it titles "Sales" must not link to GildOps' page.
    expect(renderer).not.toMatch(/PRODUCT_HREF_BY_TITLE|PRODUCT_ICON_BY_TITLE/);
    expect(renderer).not.toMatch(/['"]\/(sales|operations|customer-service|dialer|products)['"]/);
  });

  it('describes in the product inventory every product the homepage names', () => {
    const titles = groups.flatMap((group) => group.items.map((item) => item.title));
    const names = new Set(OFFERINGS.map((offering) => offering.name));
    for (const title of titles) expect(names.has(title), title).toBe(true);
  });
});

describe('the page sells outcomes and only demonstrated behavior', () => {
  it('does not lead with providers or internal architecture vocabulary', () => {
    for (const forbidden of [/\bStripe\b/i, /\bTwilio\b/i, /\bSupabase\b/i, /\bPostgres\b/i, /\bAnthropic\b/i, /\bkernel\b/i, /\bmilestone\b/i]) {
      expect(page + renderer).not.toMatch(forbidden);
      expect(JSON.stringify(seededSections)).not.toMatch(forbidden);
    }
  });

  it('does not read like internal architecture documentation', () => {
    for (const forbidden of [/control stays explicit/i, /one foundation/i, /tenant boundary/i, /configure the operation/i, /automate deliberately/i]) {
      expect(JSON.stringify(seededSections)).not.toMatch(forbidden);
    }
  });

  it('introduces no fabricated proof, prices, or performance claims', () => {
    for (const forbidden of [/trusted by/i, /testimonial/i, /guarantee/i, /\d+[,+]?\s*(customers|businesses|tenants)\b/i, /\$[\d,]+/, /% (faster|more|less)/i]) {
      expect(renderer).not.toMatch(forbidden);
      expect(JSON.stringify(seededSections)).not.toMatch(forbidden);
    }
  });

  it('draws no illustrated dashboard on the homepage', () => {
    for (const section of sections) {
      if (section.kind === 'hero') expect(section.variant).not.toBe('preview');
    }
    // A business may still choose the preview hero; it says it is an example.
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
