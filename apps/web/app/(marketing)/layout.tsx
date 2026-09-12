import Link from 'next/link';
import { ButtonLink } from '@/components/controls/button';
import { FOCUS_RING, cx } from '@/components/class-names';
import { SiteShell } from '@/components/containers/site-shell';
import type { Metadata } from 'next';
import { BrandStyle } from '@/features/branding/brand-style';
import { getPublishedGoldHomepage } from '@/lib/domain/public-site/cached';
import { getPublicDb } from '@/lib/db/public';

/**
 * Every page in this group inherits this layout's own fetch of the published homepage — brand,
 * logo, nav copy — so leaving it implicitly static would prerender `/login`, `/sign-up` and
 * `/workflow-review` against the database at build time too, not just `/`. Forced dynamic here
 * for the same reason `page.tsx` is; see the comment there and `public-site-schema.test.ts`.
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
 * (product reality audit, Slice 4). GOLD's initial commercial motion is a configured
 * implementation sold through a workflow review, not self-service signup, so the button that
 * gets the strong treatment is the review, and signing in is the plain link beside it.
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
      nav={
        <div className="flex items-center gap-6 text-sm text-muted">
          <Link href="#how-it-works" className={cx('rounded hover:text-foreground', FOCUS_RING)}>
            How it works
          </Link>
          <Link href="#capabilities" className={cx('rounded hover:text-foreground', FOCUS_RING)}>
            Capabilities
          </Link>
        </div>
      }
      action={
        <div className="flex shrink-0 items-center gap-4">
          <Link
            href="/login"
            className={cx('rounded text-sm text-muted hover:text-foreground', FOCUS_RING)}
          >
            Log in
          </Link>
          <ButtonLink href="/workflow-review" tone="primary" size="small">
            Request a workflow review
          </ButtonLink>
        </div>
      }
    >
      {children}
      </SiteShell>
    </div>
  );
}
