import { SiteShell } from '@/components/containers/site-shell';
import type { Metadata } from 'next';
import { BrandStyle } from '@/features/branding/brand-style';
import { MarketingActions, MarketingNav } from '@/components/marketing/marketing-nav';
import { MobileDemoCta } from '@/components/marketing/mobile-demo-cta';
import { getPublishedGoldHomepage } from '@/lib/domain/public-site/cached';
import { getPublicDb } from '@/lib/db/public';

/**
 * Every page in this group inherits this layout's own fetch of the published homepage — brand,
 * logo, nav copy — so leaving it implicitly static would prerender `/sales`, `/pricing`, `/demo`
 * and the rest of this group against the database at build time too, not just `/`. Forced dynamic
 * here for the same reason `page.tsx` is; see the comment there and `public-site-schema.test.ts`.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const site = await getPublishedGoldHomepage();
  return {
    openGraph: { type: 'website', siteName: site.profile.displayName, title: site.seoTitle, description: site.seoDescription, url: '/' },
    twitter: { card: 'summary', title: site.seoTitle, description: site.seoDescription },
  };
}

/**
 * GOLD's own front door, in GOLD's own chrome — the same header and footer the credential
 * screens wear, so moving between them does not feel like moving between two applications.
 *
 * Not the tenant marketing surface D20 defers: the business making claims on these pages is
 * GOLD, which is why `public-profile.test.ts` scans `app/(public)/` and not this group.
 *
 * **The header's right side is Log in, then the primary CTA — never two equal buttons**
 * (product reality audit, Slice 4). Request a demo gets the strong treatment; signing in is the
 * plain link beside it.
 */
export default async function MarketingLayout({ children }: LayoutProps<'/'>) {
  const site = await getPublishedGoldHomepage();
  return (
    <div data-brand>
      <BrandStyle brand={site.brand} />
      <SiteShell
      name={site.profile.displayName}
      logoUrl={site.brand.logoPath ? getPublicDb().storage.from('brand').getPublicUrl(site.brand.logoPath).data.publicUrl : null}
      footerLine={site.profile.tagline ?? 'One system that runs your business.'}
      nav={<MarketingNav />}
      action={<MarketingActions />}
    >
      <div className="pb-16 sm:pb-0">{children}</div>
      <MobileDemoCta />
      </SiteShell>
    </div>
  );
}
