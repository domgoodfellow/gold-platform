import type { ReactNode } from 'react';
import { MarketingFooter } from './marketing-footer';
import { MarketingHeader } from './marketing-header';
import { MobileDemoCta } from './mobile-demo-cta';

/** Footer line when GildOps' own profile has no tagline, or could not be read. */
const FALLBACK_TAGLINE = 'AI, automation and business software, set up around how you work.';

/**
 * The one frame every GildOps marketing page and credential screen wears: header, page, footer,
 * and on marketing pages the phone-sized demo bar. Not `AppShell`, and never a tenant's
 * `(public)` surface.
 */
export function MarketingShell({
  name,
  logoUrl,
  tagline,
  contactEmail,
  contactPhone,
  showMobileDemoCta = true,
  children,
}: {
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Off on the credential screens: a fixed bar over a form on a phone covers its fields. */
  showMobileDemoCta?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-col">
      <MarketingHeader name={name} logoUrl={logoUrl} />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col p-6 sm:p-8">{children}</main>
      <MarketingFooter
        name={name}
        tagline={tagline ?? FALLBACK_TAGLINE}
        contactEmail={contactEmail}
        contactPhone={contactPhone}
      />
      {showMobileDemoCta ? <MobileDemoCta /> : null}
    </div>
  );
}
