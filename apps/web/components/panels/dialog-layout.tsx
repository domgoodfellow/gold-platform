'use client';
import type { ReactNode } from 'react';
import { DialogDescription, DialogTitle } from '@gold/ui/components/dialog';
import { StepIndicator } from '../display/step-indicator';

/** A focused dialog's title band; `steps` adds the shared step indicator. */
export function StepHeader({ title, description, steps, current = 0 }: { title: string; description?: ReactNode; steps?: string[]; current?: number }) {
  return <div className="flex flex-col gap-3 border-b border-border px-5 pb-4 pt-5 pr-12">
    <div className="flex flex-col gap-1"><DialogTitle>{title}</DialogTitle>{description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}</div>
    {steps ? <StepIndicator steps={steps} current={current} /> : null}
  </div>;
}

/** The scrolling middle: on a short or narrow screen only this part scrolls, so the actions stay reachable. */
export function DialogBody({ children }: { children: ReactNode }) {
  return <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>;
}

/** One primary action first in reading order; it sits at the end of the row on wide screens. */
export function DialogFooterBar({ children }: { children: ReactNode }) {
  return <div data-slot="dialog-footer" data-dialog-footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row-reverse sm:items-center">{children}</div>;
}
