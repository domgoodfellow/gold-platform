import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WebsiteSectionSchema, type SectionOf, type WebsiteSection } from '@gold/schemas';
import { MarketingHomepage } from '@/features/marketing-site/homepage';
import { homepageBlocks } from '@/features/marketing-site/homepage-model';
import { AVAILABILITY, OFFERINGS, offeringHref } from '@/lib/marketing/content';

const MIGRATIONS = fileURLToPath(new URL('../../../../../supabase/migrations', import.meta.url));
const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), 'utf8');

/** GildOps' homepage as the latest seed publishes it; see marketing-homepage.test.ts. */
const seedFile = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .filter((file) => readFileSync(`${MIGRATIONS}/${file}`, 'utf8').includes('function app.default_gold_homepage_sections()'))
  .at(-1)!;
const seeded = JSON.parse(/select \$json\$([\s\S]*?)\$json\$::jsonb/.exec(readFileSync(`${MIGRATIONS}/${seedFile}`, 'utf8'))![1]!) as Record<string, unknown>[];
const sections: WebsiteSection[] = seeded.map((section, index) => WebsiteSectionSchema.parse({ ...section, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
const context = { mode: 'live' as const, forms: {} };
const render = (input: WebsiteSection[]) => renderToStaticMarkup(createElement(MarketingHomepage, { sections: input, context }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('the homepage composes its published content, never replaces it', () => {
  const html = render(sections);
  const visible = text(html);

  it('draws every published heading, product, step and statement as HTML, in published order', () => {
    const expected = sections.flatMap((section) => {
      const own = 'heading' in section ? [section.heading] : [];
      const items = 'items' in section ? (section.items as { title: string; body: string }[]).flatMap((item) => [item.title, item.body]) : [];
      return [...own, ...items];
    });
    let cursor = 0;
    for (const phrase of expected) {
      const at = visible.indexOf(phrase, cursor);
      expect(at, phrase).toBeGreaterThanOrEqual(0);
      cursor = at;
    }
    expect(html).not.toMatch(/<img|<canvas|<image/);
  });

  it('gives every seeded section a composition of its own', () => {
    expect(homepageBlocks(sections).map((block) => block.kind)).toEqual(['hero', 'products', 'products', 'products', 'process', 'trust', 'closing']);
    for (const name of ['hero', 'tools', 'ai', 'connected', 'process', 'trust', 'closing']) {
      expect(html).toContain(`data-fragment-group="${name}"`);
    }
  });

  it('shows each product\'s availability from the inventory, matched by destination', () => {
    for (const section of sections.filter((entry): entry is SectionOf<'capabilities'> => entry.kind === 'capabilities')) {
      for (const item of section.items) {
        const offering = OFFERINGS.find((entry) => offeringHref(entry) === item.href)!;
        expect(offering, item.href).toBeDefined();
        const link = new RegExp(`<a[^>]*href="${item.href!.replace(/[#/]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</a>`).exec(html)?.[1] ?? '';
        expect(link).toContain(item.title);
        expect(link).toContain(AVAILABILITY[offering.availability].label);
      }
    }
  });

  it('keeps one h1, the process as an ordered list, and each hero link pointing at a group on the page', () => {
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toMatch(/<ol class="fg-cells"/);
    const targets = [...html.matchAll(/class="fg-content ms-hero-group" href="#([a-z]+)"/g)].map((match) => match[1]);
    expect(targets).toEqual(['tools', 'ai', 'connected']);
    for (const target of targets) expect(html).toContain(`id="${target}"`);
    expect(html).toContain('id="how-it-works"');
  });

  it('keeps geometry, material and light out of assistive technology and out of the tab order', () => {
    for (const match of html.matchAll(/<(span|div|svg)[^>]*class="(fg-surface|fg-art|fg-seams)"[^>]*>/g)) {
      if (match[2] === 'fg-seams') expect(match[0]).toContain('focusable="false"');
      else expect(match[0]).toContain('aria-hidden="true"');
    }
    expect(html).not.toMatch(/class="fg-(surface|art)"[^>]*tabindex/);
  });
});

describe('content no composition fits keeps the shared renderer', () => {
  const groups = sections.filter((section): section is SectionOf<'capabilities'> => section.kind === 'capabilities');
  const tools = groups[0]!;

  it('keeps an unknown destination, an extra product or a mixed group exactly as authored', () => {
    const unknown = { ...tools, items: [{ ...tools.items[0]!, href: '/contact' }, ...tools.items.slice(1)] };
    const extra = { ...tools, items: [...tools.items, { title: 'Fourth published entry', body: 'Must remain visible.', href: '/contact' }] };
    const mixed = { ...tools, items: [tools.items[0]!, tools.items[1]!, groups[1]!.items[0]!] };
    for (const section of [unknown, extra, mixed]) {
      const [block] = homepageBlocks([section]);
      expect(block!.kind).toBe('shared');
      const html = render([section]);
      expect(html).toContain('data-section="capabilities"');
      for (const item of section.items) expect(text(html)).toContain(item.title);
    }
  });

  it('draws the hero plainly when the product groups below it are not all composed', () => {
    const hero = sections.find((section) => section.kind === 'hero')!;
    expect(homepageBlocks([hero, groups[0]!]).map((block) => block.kind)).toEqual(['shared', 'products']);
  });
});

describe('the composition system stays out of tenant websites and Studio', () => {
  it('leaves the shared section renderer, the tenant site and Studio\'s canvas without it', () => {
    for (const file of ['features/public-site/section-renderers.tsx', 'features/public-site/site-view.tsx', 'features/studio/website/website-canvas.tsx', 'app/(public)/layout.tsx']) {
      const source = read(file);
      expect(source, file).not.toMatch(/visual-composition|marketing-site|FragmentGroup|data-material/);
    }
  });

  it('reaches GildOps\' compositions outside its marketing routes only through the experience the database names', () => {
    const view = read('features/public-site/experience-view.tsx');
    expect(view).toContain("experience === 'gildops_marketing'");
    expect(view).toContain('<MarketingHomepage');
    expect(view).toContain('<SiteView');
  });

  it('ships one light for the page as the only client code, and no fracture artwork', () => {
    expect(read('features/visual-composition/lighting-controller.tsx')).toMatch(/^'use client';/);
    for (const file of ['features/visual-composition/fragment-group.tsx', 'features/visual-composition/seam-network.tsx', 'features/marketing-site/homepage.tsx', 'features/marketing-site/closing.tsx', 'features/marketing-site/product-landing.tsx', 'features/marketing-site/frame.tsx']) {
      expect(read(file), file).not.toMatch(/^['"]use client['"]/);
    }
    // The marketing layout wears the one frame; the frame owns the light, only where it owns the window.
    expect(read('app/(marketing)/layout.tsx')).toContain('<MarketingFrame');
    expect(read('features/marketing-site/frame.tsx')).toContain('{standalone ? <LightingController /> : null}');
    expect(read('app/globals.css')).not.toMatch(/kintsugi|gilded/);
  });
});
