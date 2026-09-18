import type { ReactNode } from 'react';
import { MarketingFooter } from './marketing-footer';
import { MarketingHeader } from './marketing-header';
import { MobileDemoCta } from './mobile-demo-cta';

/**
 * The one frame every GOLD marketing page wears: header, page, footer, and the phone-sized demo
 * bar. Not `AppShell` and not `SiteShell` (the credential screens' plainer chrome), and never a
 * tenant's `(public)` surface (D20).
 */
export function MarketingShell({
  name,
  logoUrl,
  tagline,
  contactEmail,
  contactPhone,
  children,
}: {
  name: string;
  logoUrl: string | null;
  tagline: string;
  contactEmail: string | null;
  contactPhone: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <MarketingHeader name={name} logoUrl={logoUrl} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6 sm:p-8">{children}</main>
      <MarketingFooter name={name} tagline={tagline} contactEmail={contactEmail} contactPhone={contactPhone} />
      <MobileDemoCta />
    </div>
  );
}
