import type { Metadata } from 'next';
import { HomepageRenderer } from '@/features/public-site/homepage-renderer';
import { getPublishedGoldHomepage } from '@/lib/domain/public-site/cached';
import { canonicalUrl } from '@/lib/seo/site';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublishedGoldHomepage();
  return { title: site.seoTitle, description: site.seoDescription, alternates: { canonical: '/' } };
}

export default async function Home() {
  const site = await getPublishedGoldHomepage();
  const home = canonicalUrl('/').toString();
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${home}#organization`, name: site.profile.displayName, url: home },
      { '@type': 'WebSite', '@id': `${home}#website`, name: site.profile.displayName, url: home, publisher: { '@id': `${home}#organization` } },
      { '@type': 'WebPage', '@id': home, name: site.seoTitle, description: site.seoDescription, isPartOf: { '@id': `${home}#website` }, about: { '@id': `${home}#organization` } },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <HomepageRenderer sections={site.sections} />
    </>
  );
}
