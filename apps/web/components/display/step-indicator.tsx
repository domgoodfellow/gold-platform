import Link from 'next/link';
import { Check } from 'lucide-react';
import { cx, FOCUS_RING } from '../class-names';

/**
 * Where a multi-step task stands: done, current and still-to-come steps, in one ordered list. A
 * step with an `href` is a way back (only completed steps should carry one); the current step is
 * marked `aria-current="step"`. Steps wrap rather than scroll, so every label stays readable.
 */
export function StepIndicator({ steps, current, label = 'Progress', className }: {
  steps: (string | { label: string; href?: string })[]; current: number; label?: string; className?: string;
}) {
  return <nav aria-label={label} className={cx('min-w-0', className)}>
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {steps.map((step, index) => {
        const { label: name, href } = typeof step === 'string' ? { label: step, href: undefined } : step;
        const state = index < current ? 'done' : index === current ? 'current' : 'next';
        const marker = <span aria-hidden className={cx('flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] tabular-nums',
          state === 'current' ? 'border-accent bg-accent text-on-accent' : state === 'done' ? 'border-border bg-secondary text-foreground' : 'border-border text-muted')}>
          {state === 'done' ? <Check className="size-3" /> : index + 1}</span>;
        const text = <span className={state === 'current' ? 'font-medium text-foreground' : 'text-muted'}>{name}<span className="sr-only">{state === 'done' ? ' (completed)' : ''}</span></span>;
        return <li key={name} className="flex items-center gap-2" aria-current={state === 'current' ? 'step' : undefined}>
          {index > 0 ? <span aria-hidden className="h-px w-3 bg-border" /> : null}
          {href && state === 'done' ? <Link href={href} className={cx('flex items-center gap-1.5 rounded-sm hover:underline', FOCUS_RING)}>{marker}{text}</Link> : <span className="flex items-center gap-1.5">{marker}{text}</span>}
        </li>;
      })}
    </ol>
  </nav>;
}
