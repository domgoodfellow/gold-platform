import { AuthBackground } from '@/components/auth/auth-background';
import { SiteShell } from '@/components/containers/site-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
    <SiteShell>
      {/* Centred in what is left after the header and footer, and never wider than a form wants
          to be read at. */}
      <div className="relative flex flex-1 items-center justify-center">
        <AuthBackground />
        <div className="relative w-full max-w-sm">{children}</div>
      </div>
    </SiteShell>
  );
}
