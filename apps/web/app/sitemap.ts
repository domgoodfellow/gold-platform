import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/lib/seo/site';

/** Only deliberate, indexable GOLD marketing routes belong here. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: canonicalUrl('/').toString(), changeFrequency: 'weekly', priority: 1 },
    ...(['/sales', '/operations', '/customer-service'] as const).map((path) => ({
      url: canonicalUrl(path).toString(),
      changeFrequency: 'weekly' as const,
      priority: 0.9,
    })),
    ...(['/how-it-works', '/integrations', '/pricing'] as const).map((path) => ({
      url: canonicalUrl(path).toString(),
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
    { url: canonicalUrl('/demo').toString(), changeFrequency: 'monthly', priority: 0.8 },
  ];
}
