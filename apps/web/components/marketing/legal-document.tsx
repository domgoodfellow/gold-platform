import Link from 'next/link';
import type { ReactNode } from 'react';

export interface LegalSection {
  heading: string;
  body: ReactNode;
}

/**
 * A plain routed legal page. Not a policy-management system: the text is a typed list in the
 * route file. `pendingReview` renders the notice a reader is owed while a page is an initial
 * version — it is removed by whoever confirms the text with counsel, in the same edit.
 */
export function LegalDocument({
  title,
  intro,
  sections,
  pendingReview,
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  pendingReview: boolean;
}) {
  return (
    <article className="flex flex-col gap-10 py-6 sm:py-10">
      <header className="-mx-2 rounded-2xl bg-secondary px-6 py-12 sm:px-12">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-subtle">Legal</p>
        <h1 className="mt-3 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">{title}</h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted">{intro}</p>
      </header>

      {pendingReview ? (
        <p role="note" className="max-w-3xl rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed text-muted">
          This is an initial version and has not yet been confirmed by legal counsel. It may change
          before it is relied on as final.
        </p>
      ) : null}

      <div className="flex max-w-3xl flex-col gap-8">
        {sections.map((section) => (
          <section key={section.heading} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold tracking-tight">{section.heading}</h2>
            <div className="flex flex-col gap-3 leading-relaxed text-muted">{section.body}</div>
          </section>
        ))}
      </div>

      <p className="max-w-3xl border-t border-border pt-6 text-sm text-muted">
        Questions about this page? <Link href="/contact" className="font-medium text-foreground underline underline-offset-4">Contact us</Link>.
      </p>
    </article>
  );
}
