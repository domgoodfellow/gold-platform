import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sitemap from '@/app/sitemap';
import robots from '@/app/robots';
import { isPublic } from '@/lib/route/access';
import { ACCOUNT_LINKS, COMPANY_LINKS, HEADER_LINKS, LEGAL_LINKS, MARKETING_PATHS, PRODUCT_LINKS } from '@/lib/marketing/navigation';

const APP = fileURLToPath(new URL('../../../app', import.meta.url));
const read = (relative: string) => readFileSync(fileURLToPath(new URL(`../../../${relative}`, import.meta.url)), 'utf8');

const NAVIGATED = [...PRODUCT_LINKS, ...COMPANY_LINKS, ...HEADER_LINKS, ...LEGAL_LINKS, ...ACCOUNT_LINKS].map((link) => link.href);

describe('the marketing header and footer have no dead links', () => {
  it('points every link at a page that exists', () => {
    for (const href of NAVIGATED) {
      const marketing = existsSync(`${APP}/(marketing)${href}/page.tsx`);
      const auth = existsSync(`${APP}/(auth)${href}/page.tsx`);
      expect(marketing || auth, `${href} has no page`).toBe(true);
    }
  });

  it('keeps every marketing path public, crawlable and in the sitemap', () => {
    const listed = sitemap().map((entry) => new URL(entry.url).pathname);
    const policy = robots().rules;
    const rules = Array.isArray(policy) ? policy : [policy];
    const allowed = rules.flatMap((rule) => rule.allow ?? []);
    for (const path of MARKETING_PATHS) {
      expect(isPublic(path), `${path} is not public`).toBe(true);
      expect(listed).toContain(path);
      expect(allowed).toContain(path);
    }
  });

  it('carries the header links the brief names', () => {
    expect(HEADER_LINKS.map((link) => link.label)).toEqual(['How it works', 'Integrations', 'Pricing', 'Contact']);
    expect(PRODUCT_LINKS.map((link) => link.label)).toEqual(['All products', 'Dialer', 'Sales', 'Operations', 'Customer Service']);
  });
});

describe('every marketing page shares one frame', () => {
  it('renders header and footer from the group layout alone, with one primary action and no fixed phone bar', () => {
    const layout = read('app/(marketing)/layout.tsx');
    const shell = read('components/marketing/marketing-shell.tsx');
    expect(layout).toContain('MarketingShell');
    expect(shell).toContain('MarketingHeader');
    expect(shell).toContain('MarketingFooter');
    // The header carries the consultation action on every width; a second, fixed copy along the
    // bottom of a phone repeated it and covered the page.
    expect(shell).not.toMatch(/MobileDemoCta|fixed inset-x-0 bottom-0/);
    expect(existsSync(fileURLToPath(new URL('../../../components/marketing/mobile-demo-cta.tsx', import.meta.url)))).toBe(false);
  });

  it('scopes the GildOps palette to the marketing frame, never to a tenant renderer', () => {
    const shell = read('components/marketing/marketing-shell.tsx');
    const css = read('app/globals.css');
    expect(shell).toContain('data-marketing-site');
    expect(css).toContain('[data-marketing-site] {');
    for (const file of ['features/public-site/section-renderers.tsx', 'features/public-site/site-view.tsx', 'app/(public)/layout.tsx']) {
      const path = fileURLToPath(new URL(`../../../${file}`, import.meta.url));
      if (existsSync(path)) expect(readFileSync(path, 'utf8'), file).not.toContain('data-marketing-site');
    }
  });

  it('gives every marketing page its own metadata', () => {
    for (const path of MARKETING_PATHS) {
      if (path === '/') continue;
      const page = read(`app/(marketing)${path}/page.tsx`);
      expect(page, `${path} lacks metadata`).toMatch(/export const metadata|generateMetadata/);
    }
  });

  it('never puts GOLD marketing chrome on a tenant (public) page', () => {
    for (const file of ['app/(public)/layout.tsx']) {
      expect(read(file)).not.toMatch(/MarketingShell|MarketingHeader|MarketingFooter/);
    }
  });

  it('draws footer contact details only from the configured profile', () => {
    const footer = read('components/marketing/marketing-footer.tsx');
    expect(footer).toContain('contactEmail ?');
    expect(footer).toContain('contactPhone ?');
    expect(footer).not.toMatch(/mailto:[a-z0-9._-]+@/i);
  });
});

describe('the contact page is not the demo page', () => {
  it('enters GOLD through the shared intake, as a contact', () => {
    expect(read('app/(marketing)/contact/actions.ts')).toMatch(/kind: 'contact'/);
    expect(read('app/(marketing)/demo/actions.ts')).toMatch(/kind: 'demo'/);
  });
});
