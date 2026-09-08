import { ButtonLink } from '@/components/controls/button';
import { SiteShell } from '@/components/containers/site-shell';

/**
 * The four credential screens — log in, sign up, ask for a recovery link, set a new one.
 *
 * They sit in GOLD's own chrome (`SiteShell`) rather than on a bare page, because somebody
 * arriving here has usually come from the front page and there was nothing to say they were
 * still in the same place — no wordmark, no way back, nothing but a form in the middle of
 * white. The header is also the way out of a flow somebody entered by mistake.
 *
 * A route group is a layout boundary, never a security boundary — `proxy.ts` decides what an
 * anonymous caller may open, by path, and groups do not change paths (I12).
 */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <SiteShell
      // Not a link to the screen you are already on: from any of these four, the useful other
      // place is the front page, and the wordmark already goes there. What this offers instead
      // is the one thing the marketing page sells.
      action={
        <ButtonLink href="/sign-up" tone="secondary" size="small">
          Create an account
        </ButtonLink>
      }
    >
      {/* Centred in what is left after the header and footer, and never wider than a form wants
          to be read at. */}
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </SiteShell>
  );
}
