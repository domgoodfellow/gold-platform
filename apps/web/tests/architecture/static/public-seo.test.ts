import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';
import { canonicalUrl, siteUrl } from '@/lib/seo/site';

describe('canonical deployment identity', () => {
  it('uses configured identity rather than a request Host header', () => {
    const previous = process.env.SITE_URL;
    process.env.SITE_URL = 'https://gold.example/path?wrong=1';
    try {
      expect(siteUrl().toString()).toBe('https://gold.example/');
      expect(canonicalUrl('/demo').toString()).toBe(
        'https://gold.example/demo',
      );
    } finally {
      if (previous === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previous;
    }
  });

  it('refuses a non-web protocol', () => {
    const previous = process.env.SITE_URL;
    process.env.SITE_URL = 'javascript:alert(1)';
    try {
      expect(() => siteUrl()).toThrow(/http or https/);
    } finally {
      if (previous === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = previous;
    }
  });
});

describe('crawl surface', () => {
  it('lists only deliberate marketing routes in the sitemap', () => {
    const urls = sitemap().map((entry) => new URL(entry.url).pathname);
    expect(urls).toEqual([
      '/', '/products', '/dialer', '/sales', '/operations', '/customer-service', '/how-it-works', '/integrations',
      '/pricing', '/contact', '/demo', '/privacy', '/terms',
    ]);
    expect(urls).not.toContain('/login');
    expect(urls).not.toContain('/portal');
  });

  it('keeps protected and token-bearing areas out of crawling', () => {
    const policy = robots();
    const rules = Array.isArray(policy.rules) ? policy.rules : [policy.rules];
    const disallowed = rules.flatMap((rule) => rule.disallow ?? []);
    expect(disallowed).toContain('/organizations/');
    expect(disallowed).toContain('/platform/');
    expect(disallowed).toContain('/portal');
    expect(disallowed).toContain('/portal/');
  });

  it('marks auth and tenant transaction layouts noindex', () => {
    const auth = readFileSync(
      fileURLToPath(new URL('../../../app/(auth)/layout.tsx', import.meta.url)),
      'utf8',
    );
    const tenant = readFileSync(
      fileURLToPath(new URL('../../../app/(public)/layout.tsx', import.meta.url)),
      'utf8',
    );
    expect(auth).toMatch(/index:\s*false/);
    expect(tenant).toMatch(/index:\s*false/);
    expect(tenant).toMatch(/noarchive:\s*true/);
  });

  it('marks invitation credentials noindex and noarchive', () => {
    const invitation = readFileSync(
      fileURLToPath(
        new URL('../../../app/organizations/accept-invite/[token]/page.tsx', import.meta.url),
      ),
      'utf8',
    );
    expect(invitation).toMatch(/index:\s*false/);
    expect(invitation).toMatch(/noarchive:\s*true/);
  });
});

describe('not-found ownership', () => {
  it('keeps GOLD chrome off the tenant-specific not-found state', () => {
    const tenantNotFound = readFileSync(
      fileURLToPath(new URL('../../../app/(public)/not-found.tsx', import.meta.url)),
      'utf8',
    );
    expect(tenantNotFound).not.toContain('SiteShell');
    expect(tenantNotFound).not.toMatch(/>\s*GOLD\s*</);
  });
});
