import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/lib/seo/site';
import { MARKETING_PATHS } from '@/lib/marketing/navigation';

/** GOLD's crawl policy. Page-level noindex remains the authority for reachable credential pages. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [...MARKETING_PATHS, '/book/'],
      disallow: [
        '/organizations/',
        '/platform/',
        '/portal', '/portal/',
        '/auth/',
        '/reset-password',
      ],
    },
    sitemap: canonicalUrl('/sitemap.xml').toString(),
  };
}
