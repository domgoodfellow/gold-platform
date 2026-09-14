'use client';

import { useState, type ReactNode } from 'react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@gold/ui/components/dialog';
import { Button, type ButtonSize, type ButtonTone } from '../controls/button';

/** A destructive submit confirmed through the source-owned shadcn Dialog. */
export function ConfirmSubmit({
  formId,
  label,
  confirmLabel,
  description,
  tone = 'danger',
  size = 'small',
  pending,
  className,
  ariaLabel,
}: {
  formId: string;
  label: ReactNode;
  confirmLabel: ReactNode;
  description: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
  pending?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" tone={tone} size={size} disabled={pending} aria-label={ariaLabel} className={className}>
          {pending ? '…' : label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmLabel}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" tone="secondary" size="small">Cancel</Button>
          </DialogClose>
          <Button type="submit" form={formId} tone="danger" size="small" onClick={() => setOpen(false)}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
};
