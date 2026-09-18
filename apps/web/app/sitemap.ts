import type { MetadataRoute } from 'next';
import { canonicalUrl } from '@/lib/seo/site';
import { MARKETING_PATHS } from '@/lib/marketing/navigation';

const PRIORITY: Record<string, number> = {
  '/': 1,
  '/sales': 0.9,
  '/operations': 0.9,
  '/customer-service': 0.9,
  '/demo': 0.8,
  '/how-it-works': 0.7,
  '/integrations': 0.7,
  '/pricing': 0.7,
  '/contact': 0.6,
  '/privacy': 0.3,
  '/terms': 0.3,
};

/** Only deliberate, indexable GOLD marketing routes belong here — the same list the header and footer draw. */
export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_PATHS.map((path) => ({
    url: canonicalUrl(path).toString(),
    changeFrequency: PRIORITY[path] >= 0.9 ? 'weekly' : 'monthly',
    priority: PRIORITY[path],
  }));
}
