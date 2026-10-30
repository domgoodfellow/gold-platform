'use client';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@gold/ui/components/dialog';
import { Button } from '../controls/button';
import { cx } from '../class-names';

type GuardContext = { requestClose: () => void; setDirty: (dirty: boolean) => void };
const Guard = createContext<GuardContext | null>(null);

/**
 * A centered, responsive dialog for a focused create or edit task (`docs/ui-system.md`), with the
 * same unsaved-change contract as `PageDrawer`: a form inside reports unsaved input with
 * `useGuardedDialogDirty(dirty)`, and then Escape, the close button and `useGuardedDialogClose()`
 * (Cancel) ask before discarding. An owner setting `open` to false itself — after a successful
 * save — is deliberate and never asked about. Focus returns to whatever opened the dialog, since
 * our triggers are ordinary buttons rather than Radix's own.
 *
 * Only the middle scrolls on a short or narrow screen, so the actions stay reachable; drawers stay
 * for contextual inspectors and supporting panels.
 */
export function GuardedDialog({ open, onOpenChange, children, className, size = 'default', discardDescription = 'Your changes have not been saved.' }: {
  open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode; className?: string; size?: 'default' | 'compact'; discardDescription?: string;
}) {
  const dirty = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  // Where focus was inside the dialog when the discard prompt opened; Keep editing returns it there.
  const resume = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const [confirmRequested, setConfirming] = useState(false);
  // A confirmation belongs to one open dialog; an owner closing it any other way also ends it.
  const confirming = open && confirmRequested;
  // Layout effects run before Radix moves focus into the dialog, so this still sees the opener.
  useLayoutEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && !document.activeElement.closest('[role=dialog]')) opener.current = document.activeElement;
    if (!open) dirty.current = false;
  }, [open]);
  const close = useCallback(() => { dirty.current = false; setConfirming(false); onOpenChange(false); }, [onOpenChange]);
  const requestClose = useCallback(() => {
    if (!dirty.current) { close(); return; }
    resume.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirming(true);
  }, [close]);
  const setDirty = useCallback((value: boolean) => { dirty.current = value; }, []);
  return <Guard.Provider value={{ requestClose, setDirty }}>
    <Dialog open={open} onOpenChange={next => { if (!next) requestClose(); }}>
      <DialogContent ref={content} onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}
        className={cx('flex max-h-[min(92dvh,46rem)] flex-col gap-0 overflow-hidden p-0', size === 'compact' ? 'w-[min(32rem,calc(100%-1rem))]' : 'w-[min(40rem,calc(100%-1rem))]', className)}>
        {children}
      </DialogContent>
    </Dialog>
    <Dialog open={confirming} onOpenChange={setConfirming}>
      <DialogContent role="alertdialog" showCloseButton={false} onCloseAutoFocus={event => {
        // Returning to editing puts focus back where it was; discarding lets the outer dialog restore its opener.
        if (!open) return;
        event.preventDefault();
        const target = resume.current?.isConnected && content.current?.contains(resume.current) ? resume.current : content.current;
        target?.focus();
      }}>
        <DialogHeader><DialogTitle>Discard unsaved changes?</DialogTitle><DialogDescription>{discardDescription}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button type="button" tone="secondary" size="small" autoFocus onClick={() => setConfirming(false)}>Keep editing</Button>
          <Button type="button" tone="danger" size="small" onClick={close}>Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </Guard.Provider>;
}

/** Report whether the form inside differs from what it opened with. Outside a `GuardedDialog` it does nothing. */
export function useGuardedDialogDirty(dirty: boolean) {
  const guard = useContext(Guard);
  useEffect(() => { guard?.setDirty(dirty); return () => guard?.setDirty(false); }, [guard, dirty]);
}

/** Close the surrounding dialog the way its close button would: asking first when there is unsaved input. */
export function useGuardedDialogClose() {
  return useContext(Guard)?.requestClose ?? (() => {});
}
