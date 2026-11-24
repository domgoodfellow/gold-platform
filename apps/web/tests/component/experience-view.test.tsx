// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { WebsitePage, WebsiteSection } from '@gold/schemas';
import { ExperienceView } from '@/features/public-site/experience-view';
import { SiteView } from '@/features/public-site/site-view';
import { MarketingFrame } from '@/features/marketing-site/frame';
import { MarketingHomepage } from '@/features/marketing-site/homepage';
import { OFFERING_GROUPS, offeringHref, offeringsIn } from '@/lib/marketing/content';
import { newId } from '@/lib/domain/public-site/composition';
import { SECTION_REGISTRY } from '@/lib/domain/public-site/section-registry';

/**
 * Rendering parity: the private surfaces draw a revision through `ExperienceView`, and the live
 * surfaces through the components it chooses. For the same revision, experience and brand the
 * markup is the same, apart from authoring chrome added by `decorate`. (Widths and container
 * queries need a browser: `e2e/studio-stabilization.spec.ts` compares live and preview there.)
 */
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const PROFILE = { displayName: 'GildOps', tagline: 'Set up around how you work.', intro: null, contactEmail: 'hello@example.test', contactPhone: null, address: null };
const BRAND = { accent: null, headingFont: 'sans' as const, bodyFont: 'sans' as const, logoPath: null };
const CONTEXT = { mode: 'preview' as const, forms: {} };

/** GildOps' homepage shape: a hero, three product groups, the process, trust and the closing band. */
function marketingSections(): WebsiteSection[] {
  const hero = { ...SECTION_REGISTRY.hero.create(newId()), heading: 'AI, automation and business software.', body: 'Start with one product.', primaryCta: { label: 'Get started', href: '/pricing' } } as WebsiteSection;
  const groups = OFFERING_GROUPS.map((group) => ({
    ...SECTION_REGISTRY.capabilities.create(newId()),
    variant: 'list', heading: group.name, body: `${group.name} body`,
    items: offeringsIn(group.key).slice(0, 3).map((offering) => ({ title: offering.name, body: `${offering.name} body`, href: offeringHref(offering) })),
  }) as WebsiteSection);
  const process = { ...SECTION_REGISTRY.process.create(newId()), heading: 'How a project runs.', items: [1, 2, 3, 4].map((n) => ({ step: `0${n}`, title: `Step ${n}`, body: `Body ${n}` })) } as WebsiteSection;
  const trust = { ...SECTION_REGISTRY.trust.create(newId()), heading: 'What you can count on.', items: [1, 2, 3, 4].map((n) => ({ title: `Trust ${n}`, body: `Body ${n}` })) } as WebsiteSection;
  const cta = { ...SECTION_REGISTRY.cta.create(newId()), heading: 'What would you like to fix first?' } as WebsiteSection;
  return [hero, ...groups, process, trust, cta];
}

const page = (sections: WebsiteSection[], overrides: Partial<WebsitePage> = {}): WebsitePage => ({
  id: newId(), name: 'Home', slug: '', isHome: true, seoTitle: 'Home', seoDescription: 'Home', sections, ...overrides,
});

/** Markup with React's per-render ids normalised, so two renders of one tree compare equal. */
function markup(node: ReactNode): string {
  const { container, unmount } = render(<>{node}</>);
  const html = container.innerHTML.replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID');
  unmount();
  return html;
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('the GildOps marketing experience', () => {
  const home = page(marketingSections());
  const site = { pages: [home], navigation: [], profile: PROFILE, brand: BRAND };

  it('draws a revision exactly as the live marketing layout and homepage do', () => {
    const live = markup(
      <MarketingFrame brand={BRAND} profile={PROFILE} logoUrl={null}>
        <MarketingHomepage sections={home.sections} context={CONTEXT} />
      </MarketingFrame>,
    );
    const preview = markup(<ExperienceView experience="gildops_marketing" site={site} page={home} context={CONTEXT} standalone />);
    expect(preview).toBe(live);
    // The compositions are really there, not the business frame.
    expect(preview).toContain('data-marketing-home');
    expect(preview).toContain('data-marketing-site');
    expect(preview).not.toContain('max-w-5xl');
  });

  it('keeps the composed content inside a preview frame, without the window-owning parts', () => {
    const framed = markup(<ExperienceView experience="gildops_marketing" site={site} page={home} context={CONTEXT} />);
    const standalone = markup(<ExperienceView experience="gildops_marketing" site={site} page={home} context={CONTEXT} standalone />);
    const homeOf = (html: string) => html.slice(html.indexOf('data-marketing-home'), html.indexOf('</main>'));
    expect(homeOf(framed)).toBe(homeOf(standalone));
    expect(framed).not.toContain('min-h-dvh');
  });

  it('adds authoring chrome around each section without changing what the section draws', () => {
    const plain = markup(<ExperienceView experience="gildops_marketing" site={site} page={home} context={CONTEXT} />);
    const decorated = markup(
      <ExperienceView
        experience="gildops_marketing" site={site} page={home} context={CONTEXT}
        decorate={(section, rendered) => <div data-chrome={section.id}>{rendered}</div>}
      />,
    );
    for (const section of home.sections) expect(decorated).toContain(`data-chrome="${section.id}"`);
    const strip = (html: string) => html.replace(/<div data-chrome="[^"]+">/g, '');
    // Removing the wrappers' opening tags leaves one extra closing tag per section and nothing else.
    expect(strip(decorated).length - plain.length).toBe(home.sections.length * '</div>'.length);
  });
});

describe('a business website', () => {
  it('draws through the business frame, exactly as the hostname does', () => {
    const sections = [SECTION_REGISTRY.hero.create(newId()), SECTION_REGISTRY.content.create(newId()), SECTION_REGISTRY.cta.create(newId())];
    const home = page(sections);
    const site = { pages: [home], navigation: [], profile: { ...PROFILE, displayName: 'Acme Plumbing' }, brand: BRAND };
    const live = markup(<SiteView site={site} page={home} context={CONTEXT} />);
    expect(markup(<ExperienceView experience="organization_website" site={site} page={home} context={CONTEXT} />)).toBe(live);
    expect(live).not.toContain('data-marketing-site');
  });
});
