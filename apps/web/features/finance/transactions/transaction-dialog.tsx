'use client';

import { useState, type ReactNode } from 'react';
import { Button, type ButtonTone } from '@/components/controls/button';
import { GuardedDialog, useGuardedDialogClose } from '@/components/panels/guarded-dialog';

export type TransactionTriggerProps = {
  organizationId: string;
  /** Preselects the record (a row's action); the dialog then skips choosing one. */
  workItemId?: string;
  tone?: ButtonTone;
  size?: 'tiny' | 'small' | 'default';
  /** Opens on load, for an address such as `/finance/invoices?create=1`. */
  initiallyOpen?: boolean;
  label?: string;
  /** A row's trigger names its record, e.g. "Record payment for invoice #4". */
  ariaLabel?: string;
  /** Controlled opening, for a dialog launched from a menu that closes as the dialog opens. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** False when something else (a menu item) opens the dialog. */
  trigger?: boolean;
};

/**
 * A Finance transaction behind an ordinary button: a centered guarded dialog whose body mounts only
 * while open, so every opening starts from the record and nothing typed in a closed dialog lingers.
 * Focus returns to the button on close; unsaved input asks before it is discarded.
 */
export function TransactionDialog({ label, icon, tone = 'secondary', size = 'small', initiallyOpen = false, ariaLabel, open: controlled, onOpenChange, trigger = true, children }: {
  label: string; icon?: ReactNode; tone?: ButtonTone; size?: 'tiny' | 'small' | 'default'; initiallyOpen?: boolean; ariaLabel?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void; trigger?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [own, setOwn] = useState(initiallyOpen);
  const open = controlled ?? own;
  const setOpen = (next: boolean) => { if (controlled === undefined) setOwn(next); onOpenChange?.(next); };
  return <>
    {trigger ? <Button type="button" tone={tone} size={size} aria-label={ariaLabel} onClick={() => setOpen(true)}>{icon}{label}</Button> : null}
    <GuardedDialog open={open} onOpenChange={setOpen}>{open ? children(() => setOpen(false)) : null}</GuardedDialog>
  </>;
}

/** Cancel, asking first when the dialog holds unsaved input. */
export function CancelButton({ label = 'Cancel' }: { label?: string }) {
  const close = useGuardedDialogClose();
  return <Button type="button" tone="secondary" onClick={close}>{label}</Button>;
}

/** The refusal, focusable so it is read when a submit is refused. */
export function TransactionError({ error, errorRef }: { error: string | null | undefined; errorRef?: React.Ref<HTMLDivElement> }) {
  return <div ref={errorRef} tabIndex={-1} className="outline-none">{error ? <p role="alert" className="rounded-[var(--visual-radius,0.625rem)] border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p> : null}</div>;
}
