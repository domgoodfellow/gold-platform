import Link from 'next/link';
import type { ReactNode } from 'react';

/** The heading block every credential screen opens with: one h1, and an optional line under it. */
export function AuthHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {children ? <p className="text-sm text-muted-foreground">{children}</p> : null}
    </div>
  );
}

/** Separates the credential form from the other way in. A rule with a word on it, not a heading. */
export function AuthDivider() {
  return (
    <div
      className="my-6 flex items-center gap-3 text-xs uppercase tracking-wide text-muted-foreground"
      role="separator"
    >
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
      or
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

/** The secondary way onward — sign up from log in, log in from sign up, back from recovery. */
export function AuthSecondaryAction({
  prompt,
  href,
  children,
}: {
  prompt?: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <p className="mt-6 text-center text-sm text-muted-foreground">
      {prompt ? <>{prompt} </> : null}
      <Link href={href} className="font-medium text-foreground underline underline-offset-4">
        {children}
      </Link>
    </p>
  );
}
