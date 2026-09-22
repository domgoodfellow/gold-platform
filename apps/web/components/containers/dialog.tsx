'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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

/**
 * A destructive submit confirmed through the source-owned shadcn Dialog.
 *
 * **Closes itself only once the action actually finishes, never on the confirming click.** The
 * confirm button submits an external form by id (`form={formId}`) — the form lives in the caller,
 * outside this Dialog's portal — and the browser only performs that submission as the *default*
 * action of the click, after every synchronous handler has run. Closing the dialog synchronously
 * in `onClick` unmounts the very button the browser was about to submit through, and the
 * submission is lost with no error to show for it: a silent no-op "Remove" is what that looked
 * like. Watching `pending`'s own true-to-false edge closes the dialog only after the action has
 * genuinely run, whichever way it came out.
 */
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
  const wasPending = useRef(pending);

  useEffect(() => {
    if (wasPending.current && !pending) setOpen(false);
    wasPending.current = pending;
  }, [pending]);

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
          <Button type="submit" form={formId} tone="danger" size="small">
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
