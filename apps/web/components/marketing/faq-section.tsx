export interface FaqEntry {
  question: string;
  answer: string;
}

/**
 * Visible FAQ, rendered with native `<details>` so no client-side JavaScript is needed for the
 * disclosure. `faqStructuredData` below must only ever be given exactly this same list — the
 * rule that keeps `FAQPage` JSON-LD honest is that nothing is claimed here that a visitor cannot
 * also read.
 */
export function FaqSection({ id, items }: { id?: string; items: FaqEntry[] }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Frequently asked</h2>
      <div className="mt-8 divide-y divide-border border-y border-border">
        {items.map((item) => (
          <details key={item.question} className="group py-4">
            <summary className="cursor-pointer list-none text-sm font-semibold marker:content-none">
              <span className="flex items-center justify-between gap-4">
                {item.question}
                <span aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-45">+</span>
              </span>
            </summary>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** Only valid alongside `FaqSection` rendering the identical `items` — never on its own. */
export function faqStructuredData(items: FaqEntry[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}
