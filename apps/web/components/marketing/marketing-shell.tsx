import type { ReactNode } from 'react';
import { MarketingFooter } from './marketing-footer';
import { MarketingHeader } from './marketing-header';

/** Footer line when GildOps' own profile has no tagline, or could not be read. */
const FALLBACK_TAGLINE = 'AI, automation and business software, set up around how you work.';

/**
 * The one frame every GildOps marketing page and credential screen wears: header, page, footer.
 * Not `AppShell`, and never a tenant's `(public)` surface.
 *
 * `data-marketing-site` is where GildOps' own palette lands (globals.css): charcoal, cool porcelain
 * and gold for the primary action, scoped to this frame so a business's published website and
 * every operator surface keep the neutral roles. The header already carries the one primary
 * action on every width; there is no second, fixed copy of it along the bottom of a phone.
 *
 * The main column fills the viewport with the same fluid gutter as the header and footer
 * (globals.css). Reading measures belong to the individual text blocks, not the page frame.
 */
export function MarketingShell({
  name,
  logoUrl,
  tagline,
  contactEmail,
  contactPhone,
  fillViewport = true,
  children,
}: {
  name: string;
  logoUrl: string | null;
  tagline: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Off inside a preview frame, whose document is exactly as tall as its content. */
  fillViewport?: boolean;
  children: ReactNode;
}) {
  return (
    <div data-marketing-site className={`flex ${fillViewport ? 'min-h-dvh ' : ''}w-full flex-col overflow-x-clip bg-background text-foreground`}>
      <MarketingHeader name={name} logoUrl={logoUrl} />
      <main className="marketing-measure mx-auto flex w-full flex-1 flex-col p-6 sm:p-8">{children}</main>
      <MarketingFooter
        name={name}
        tagline={tagline ?? FALLBACK_TAGLINE}
        contactEmail={contactEmail}
        contactPhone={contactPhone}
      />
    </div>
  );
}
