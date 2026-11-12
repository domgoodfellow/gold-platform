'use client';

import { useId, type ComponentProps, type ElementType, type ReactNode } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@gold/ui/components/accordion';
import { Card as ShadcnCard } from '@gold/ui/components/card';
import type { SurfaceVariant } from '@gold/ui/design-system';
import { cx, FOCUS_RING } from '../class-names';
import { SectionHeader } from './section';

/** A semantic application card over the source-owned shadcn primitive. */
export function Card<T extends ElementType = 'div'>({
  as,
  className,
  variant = 'default',
  ...props
}: { as?: T; variant?: SurfaceVariant } & Omit<ComponentProps<'div'>, 'ref'>) {
  const Element = (as ?? 'div') as ElementType;
  return (
    <ShadcnCard asChild variant={variant} className={cx('gap-0 p-4 py-4', className)}>
      <Element {...props} />
    </ShadcnCard>
  );
}

/**
 * A titled group on the shared card: the heading row, then the group's content. Settings pages
 * compose their groups from this so the Appearance preset, shape and density reach every one.
 */
export function CardSection({
  id,
  headingId,
  title,
  action,
  variant,
  className,
  children,
}: {
  id?: string;
  /** Only when something else must point at the heading; otherwise one is generated. */
  headingId?: string;
  title: ReactNode;
  action?: ReactNode;
  variant?: SurfaceVariant;
  className?: string;
  children?: ReactNode;
}) {
  const generated = useId();
  const labelledBy = headingId ?? generated;
  return (
    <Card as="section" id={id} variant={variant} aria-labelledby={labelledBy} className={cx('min-w-0', className)}>
      <SectionHeader id={labelledBy} title={title} action={action} />
      {/* The card is a flex column; this keeps the content in ordinary block flow so a button keeps its own width. */}
      <div className="min-w-0">{children}</div>
    </Card>
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
