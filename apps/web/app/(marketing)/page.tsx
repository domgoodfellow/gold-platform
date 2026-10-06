import type { Metadata } from 'next';
import { PageSections } from '@/features/public-site/section-renderers';
import { getPublishedGoldHomepage } from '@/lib/domain/public-site/cached';
import { canonicalUrl } from '@/lib/seo/site';
import { PLATFORM_NAME } from '@/lib/brand';
import { getPublicDb } from '@/lib/db/public';
import { PublicCommunicationWidget } from '@/features/communications/public-widget';

/**
 * Every other database-backed route in this app declares this for the same reason: prerendering
 * at build time would run this query against whatever schema the build environment has, before
 * a deploy's migrations are guaranteed to have landed there. Left implicitly static, this page
 * alone would fail `next build` the moment a migration this projection depends on hasn't reached
 * that database yet — see `public-site-schema.test.ts` for the enforcement.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublishedGoldHomepage();
  return { title: site.seoTitle, description: site.seoDescription, alternates: { canonical: '/' } };
}

export default async function Home() {
  const site = await getPublishedGoldHomepage();
  const db = getPublicDb();
  const publicProfile = await (db.rpc.bind(db) as unknown as (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>)('public_assistant_deployment', { p_site_id: site.siteId });
  const communication = publicProfile.data as { displayName?: string; greeting?: string } | null;
  const home = canonicalUrl('/').toString();
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${home}#organization`, name: PLATFORM_NAME, url: home },
      { '@type': 'WebSite', '@id': `${home}#website`, name: PLATFORM_NAME, url: home, publisher: { '@id': `${home}#organization` } },
      { '@type': 'WebPage', '@id': home, name: site.seoTitle, description: site.seoDescription, isPartOf: { '@id': `${home}#website` }, about: { '@id': `${home}#organization` } },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      <PageSections sections={site.sections} context={{ mode: 'live', forms: site.forms }} />
      {communication?.displayName && communication.greeting ? <PublicCommunicationWidget siteId={site.siteId} name={communication.displayName} greeting={communication.greeting} /> : null}
    </>
  );
}
