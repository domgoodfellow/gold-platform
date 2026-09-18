import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';

/** The repeated final conversion band, the same visual weight everywhere it appears. */
export function CtaBand({
  heading,
  body,
  secondaryHref = '/how-it-works',
  secondaryLabel = 'See how it works',
}: {
  heading: string;
  body: string;
  secondaryHref?: string;
  secondaryLabel?: string;
}) {
  return (
    <section className="-mx-4 rounded-xl bg-foreground px-6 py-14 text-background sm:-mx-6 sm:px-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-5">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">{heading}</h2>
        <p className="max-w-xl opacity-75">{body}</p>
        <ButtonLink href="/demo" className="!inline-flex items-center gap-2 !bg-background !text-foreground">
          Request a demo <ArrowRight aria-hidden size={16} />
        </ButtonLink>
        <p className="text-sm opacity-75">
          <Link href={secondaryHref} className="font-medium underline underline-offset-4">
            {secondaryLabel}
          </Link>
        </p>
      </div>
    </section>
  );
}
