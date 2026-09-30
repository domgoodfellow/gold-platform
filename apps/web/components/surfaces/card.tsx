'use client';

import type { ComponentProps, ElementType, ReactNode } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@gold/ui/components/accordion';
import { Card as ShadcnCard } from '@gold/ui/components/card';
import { cx, FOCUS_RING } from '../class-names';

/** A semantic application card over the source-owned shadcn primitive. */
export function Card<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: { as?: T } & Omit<ComponentProps<'div'>, 'ref'>) {
  const Element = (as ?? 'div') as ElementType;
  return (
    <ShadcnCard asChild className={cx('gap-0 p-4 py-4', className)}>
      <Element {...props} />
    </ShadcnCard>
  );
}

/** A compact disclosure over shadcn Accordion, with the established GOLD API. */
export function Disclosure({
  summary,
  tone = 'default',
  defaultOpen,
  className,
  children,
  id,
}: Omit<ComponentProps<'div'>, 'title'> & {
  summary: ReactNode;
  tone?: 'default' | 'primary';
  defaultOpen?: boolean;
}) {
  return (
    <Accordion
      id={id}
      type="single"
      collapsible
      defaultValue={defaultOpen ? 'content' : undefined}
      className={cx('rounded-lg border border-border', className)}
    >
      <AccordionItem value="content" className="border-0">
        <AccordionTrigger
          className={cx(
            FOCUS_RING,
            'rounded-lg px-4 py-3 hover:no-underline',
            tone === 'primary' && 'bg-accent text-on-accent',
          )}
        >
          {summary}
        </AccordionTrigger>
        <AccordionContent className="border-t border-border px-4 py-3">
          {children}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
