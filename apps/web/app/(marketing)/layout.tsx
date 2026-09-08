import { ButtonLink } from '@/components/controls/button';
import { SiteShell } from '@/components/containers/site-shell';

/**
 * GOLD's own front door, in GOLD's own chrome — the same header and footer the credential
 * screens wear, so moving between them does not feel like moving between two applications.
 *
 * Not the tenant marketing surface D20 defers: the business making claims on these pages is
 * GOLD, which is why `public-profile.test.ts` scans `app/(public)/` and not this group.
 */
export default function MarketingLayout({ children }: LayoutProps<'/'>) {
  return (
    <SiteShell
      action={
        <ButtonLink href="/login" tone="secondary" size="small">
          Log in
        </ButtonLink>
      }
    >
      {children}
    </SiteShell>
  );
}
