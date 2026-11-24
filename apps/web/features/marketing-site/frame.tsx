import type { ReactNode } from 'react';
import type { PublicWebsiteSnapshot } from '@gold/schemas';
import { BrandStyle } from '@/features/branding/brand-style';
import { MarketingShell } from '@/components/marketing/marketing-shell';
import { LightingController } from '@/features/visual-composition/lighting-controller';
import { PLATFORM_NAME } from '@/lib/brand';

/**
 * GildOps' marketing frame — brand, header, footer and, on a page of its own, the one light — for
 * every place the marketing site is drawn: the live `(marketing)` layout, a private revision
 * preview, the Studio thumbnail and the Studio canvas. One component, so those cannot drift.
 *
 * `standalone` is the frame owning a whole browser window: it fills the viewport height and runs
 * the `LightingController`, which follows that window's scroll. Inside a preview frame it does
 * neither: the frame is exactly as tall as its content, and the static light from the stylesheet
 * applies, as it does without JavaScript.
 */
export function MarketingFrame({ brand, profile, logoUrl, standalone = true, children }: {
  brand: PublicWebsiteSnapshot['brand'];
  profile: Pick<PublicWebsiteSnapshot['profile'], 'tagline' | 'contactEmail' | 'contactPhone'>;
  logoUrl: string | null;
  standalone?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-brand>
      <BrandStyle brand={brand} />
      <MarketingShell
        name={PLATFORM_NAME}
        logoUrl={logoUrl}
        tagline={profile.tagline ?? null}
        contactEmail={profile.contactEmail}
        contactPhone={profile.contactPhone}
        fillViewport={standalone}
      >
        {children}
        {standalone ? <LightingController /> : null}
      </MarketingShell>
    </div>
  );
}
