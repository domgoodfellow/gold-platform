'use client';

import { useRef, type ComponentProps, type ReactNode, type RefObject } from 'react';
import { Button, type ButtonSize, type ButtonTone } from '../controls/button';
import { cx } from '../class-names';

/**
 * The one dialog (M11, `ui-spec.md` §5). Native `<dialog>` rather than a hand-rolled overlay —
 * `org-shell.tsx` already made this argument against a drawer: a hand-rolled version needs its
 * own state, a focus trap and an Escape key to be correct, and `showModal()` ships all three.
 * Backdrop click-to-close is the one thing it doesn't give for free.
 */
export function Dialog({
  dialogRef,
  children,
  className,
  ...props
}: Omit<ComponentProps<'dialog'>, 'ref'> & { dialogRef: RefObject<HTMLDialogElement | null> }) {
  return (
    <dialog
      ref={dialogRef}
      {...props}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close();
      }}
      className={cx(
        'rounded border border-border bg-background p-4 text-foreground backdrop:bg-black/40',
        className,
      )}
    >
      {children}
    </dialog>
  );
}

/**
 * A destructive submit, confirmed (`ui-spec.md` §6). The trigger opens the dialog rather than
 * submitting; the dialog's own Confirm button submits the *original* form through the native
 * `form` attribute, so no server action or `useActionState` wiring changes at any call site —
 * only an id on the surrounding `<form>` and this in place of the old submit `Button`.
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
  const ref = useRef<HTMLDialogElement>(null);

  return (
    <>
      <Button
        type="button"
        tone={tone}
        size={size}
        disabled={pending}
        aria-label={ariaLabel}
        className={className}
        onClick={() => ref.current?.showModal()}
      >
        {pending ? '…' : label}
      </Button>
      <Dialog dialogRef={ref} className="max-w-sm">
        <p className="text-sm">{description}</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" tone="secondary" size="small" onClick={() => ref.current?.close()}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            tone="danger"
            size="small"
            onClick={() => ref.current?.close()}
          >
            {confirmLabel}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
