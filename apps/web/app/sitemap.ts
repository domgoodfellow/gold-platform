import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/lib/seo/site';

/** Only deliberate, indexable GOLD marketing routes belong here. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: canonicalUrl('/').toString(), changeFrequency: 'weekly', priority: 1 },
    {
      url: canonicalUrl('/workflow-review').toString(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
  ];
}
