import { SiteShell } from '@/components/containers/site-shell';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * The four credential screens — log in, sign up, ask for a recovery link, set a new one.
 *
 * They sit in GildOps's own chrome (`SiteShell`) rather than on a bare page, because somebody
 * arriving here has usually come from the front page and there was nothing to say they were
 * still in the same place. The header is also the way out of a flow somebody entered by mistake.
 *
 * One bordered surface holds the form, never wider than a form wants to be read at. There is no
 * background effect: a diffuse light behind a bare form read as a smudge, not as depth.
 *
 * A route group is a layout boundary, never a security boundary — `proxy.ts` decides what an
 * anonymous caller may open, by path, and groups do not change paths (I12).
 */
export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <SiteShell>
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
          {children}
        </div>
      </div>
    </SiteShell>
  );
}
