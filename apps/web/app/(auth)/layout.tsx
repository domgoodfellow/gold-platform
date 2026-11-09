import type { Metadata } from 'next';
import { BrandStyle } from '@/features/branding/brand-style';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import { getPublishedGoldHomepage } from '@/lib/domain/public-site/cached';
import { getPublicDb } from '@/lib/db/public';
import { PLATFORM_NAME } from '@/lib/brand';

/** Reads GildOps' published homepage for the header and footer, as `(marketing)/layout.tsx` does. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The credential screens — log in, sign up, verify an email, ask for a recovery link, set a new
 * one.
 *
 * They wear the marketing site's header and footer (`MarketingShell`), because somebody arriving
 * here has usually come from the front page and should still be in the same place. The header is
 * also the way out of a flow somebody entered by mistake. The phone demo bar is left off: it would
 * sit over the form.
 *
 * Signing in must keep working when GildOps' own homepage cannot be read, so a failed read falls
 * back to the plain name and the shell's default footer line.
 *
 * One bordered surface holds the form, never wider than a form wants to be read at. There is no
 * background effect: a diffuse light behind a bare form read as a smudge, not as depth.
 *
 * A route group is a layout boundary, never a security boundary — `proxy.ts` decides what an
 * anonymous caller may open, by path, and groups do not change paths.
 */
export default async function AuthLayout({ children }: LayoutProps<'/'>) {
  const site = await getPublishedGoldHomepage().catch(() => null);
  const logoUrl = site?.brand.logoPath
    ? getPublicDb().storage.from('brand').getPublicUrl(site.brand.logoPath).data.publicUrl
    : null;

  return (
    <div data-brand>
      {site ? <BrandStyle brand={site.brand} /> : null}
      <MarketingShell
        name={PLATFORM_NAME}
        logoUrl={logoUrl}
        tagline={site?.profile.tagline ?? null}
        contactEmail={site?.profile.contactEmail ?? null}
        contactPhone={site?.profile.contactPhone ?? null}
        showMobileDemoCta={false}
      >
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
            {children}
          </div>
        </div>
      </MarketingShell>
    </div>
  );
}
