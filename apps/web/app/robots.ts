import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/lib/seo/site';

/** GOLD's crawl policy. Page-level noindex remains the authority for reachable credential pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [
        '/', '/sales', '/operations', '/customer-service', '/how-it-works', '/integrations',
        '/pricing', '/demo', '/book/',
      ],
      disallow: [
        '/organizations/',
        '/platform/',
        '/portal/',
        '/auth/',
        '/reset-password',
      ],
    },
    sitemap: canonicalUrl('/sitemap.xml').toString(),
  };
}
