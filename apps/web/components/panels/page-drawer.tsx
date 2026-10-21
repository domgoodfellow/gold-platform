'use client';

import {
  Children,
  isValidElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { XIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@gold/ui/components/dialog';
import { cx, FOCUS_RING } from '../class-names';
import { Button } from '../controls/button';
import { DRAWER_CLOSE_OFFSET, DRAWER_HEADER } from '../layout/workspace-geometry';
import { useWorkspaceRail } from './workspace-right-rail';

/**
 * The one drawer a page opens — a create or edit form, a Configure panel. It replaces the modal
 * `Sheet` for page work: nothing dims or blurs, the page stays usable beside it, and it docks full
 * height beneath the workspace header, next to the page (`PagePanel` owns where; the compact
 * header band comes from `workspace-geometry.ts`). The API mirrors `Sheet`'s so an owner
 * keeps its own `open` state, form and context; only the surface differs.
 *
 * Content is portalled into the host's slot, so it is written by its owner and survives Agent and
 * layout changes. Drawers stack: the newest shows, and closing it reveals the one beneath.
 *
 * **Unsaved changes are opt-in.** An editing form inside a drawer reports whether it holds unsaved
 * input with `usePageDrawerUnsavedChanges(dirty)`. Only then do the close button, Escape, a
 * `PageDrawerClose` (Cancel) and `usePageDrawerClose()` ask before discarding; a drawer whose form
 * never reports keeps closing at once. An owner setting `open` to false itself — after a successful
 * save — is deliberate and is never asked about. Navigation away from the page is not intercepted
 * here: in-page links, browser Back and the workspace switcher are outside the drawer's reach.
 */

type DrawerContextValue = {
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  /** Close unless an editing form reports unsaved input, in which case ask first. */
  requestClose: () => void;
  /** Whether the discard confirmation is showing. */
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  /** True while at least one form in this drawer has opted in to the unsaved-change contract. */
  guarded: boolean;
  register: () => () => void;
  setDirty: (dirty: boolean) => void;
  /** What had focus when the confirmation was asked for — it has no trigger of its own to return to. */
  returnFocus: { readonly current: HTMLElement | null };
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

function useDrawer() {
  const context = useContext(DrawerContext);
  if (!context) throw new Error('A page drawer part must sit inside <PageDrawer>.');
  return context;
}

export function PageDrawer({
  open: controlledOpen,
  onOpenChange,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const id = useId();
  const titleId = useId();
  const { openPage, closePage } = useWorkspaceRail();
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const [confirmRequested, setConfirming] = useState(false);
  // A confirmation belongs to one open drawer; an owner closing it any other way also ends it.
  const confirming = open && confirmRequested;
  const [guards, setGuards] = useState(0);
  const dirtyRef = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const setOpen = useCallback(
    (next: boolean) => {
      setConfirming(false);
      if (controlledOpen === undefined) setOwnOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  const requestClose = useCallback(() => {
    if (!dirtyRef.current) {
      setOpen(false);
      return;
    }
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirming(true);
  }, [setOpen]);

  const register = useCallback(() => {
    setGuards((count) => count + 1);
    return () => {
      dirtyRef.current = false;
      setGuards((count) => count - 1);
    };
  }, []);

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  useEffect(() => {
    if (!open) return;
    openPage(id);
    return () => closePage(id);
  }, [open, id, openPage, closePage]);

  return (
    <DrawerContext.Provider value={{ id, open, setOpen, titleId, requestClose, confirming, setConfirming, guarded: guards > 0, register, setDirty, returnFocus }}>
      {children}
    </DrawerContext.Provider>
  );
}

/**
 * Opt an editing form in to the drawer's unsaved-change contract. `dirty` is whether the form now
 * differs from what it opened with. Outside a `PageDrawer` it does nothing, so a form can be reused
 * on a full page unchanged.
 */
export function usePageDrawerUnsavedChanges(dirty: boolean) {
  const drawer = useContext(DrawerContext);
  const register = drawer?.register;
  const setDirty = drawer?.setDirty;
  useEffect(() => {
    if (!register) return;
    return register();
  }, [register]);
  useEffect(() => {
    setDirty?.(dirty);
  }, [setDirty, dirty]);
}

/** A close request that respects unsaved changes — for an owner's own Cancel or Done control. */
export function usePageDrawerClose() {
  return useDrawer().requestClose;
}

export function PageDrawerTrigger({ children, ...props }: ComponentProps<'button'> & { asChild?: boolean }) {
  const { open, setOpen } = useDrawer();
  const { asChild, ...rest } = props;
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      type={asChild ? undefined : 'button'}
      aria-expanded={open}
      {...rest}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        rest.onClick?.(event);
        if (!event.defaultPrevented) setOpen(true);
      }}
    >
      {children}
    </Component>
  );
}

export function PageDrawerClose({ children, ...props }: ComponentProps<'button'> & { asChild?: boolean }) {
  const { requestClose } = useDrawer();
  const { asChild, ...rest } = props;
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      type={asChild ? undefined : 'button'}
      {...rest}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        rest.onClick?.(event);
        if (!event.defaultPrevented) requestClose();
      }}
    >
      {children}
    </Component>
  );
}

export function PageDrawerContent({ className, children }: { className?: string; children: ReactNode }) {
  const { id, open, setOpen, titleId, requestClose, confirming, setConfirming, guarded, setDirty, returnFocus } = useDrawer();
  const { pageSlot, pageStack, showPage } = useWorkspaceRail();
  const ref = useRef<HTMLDivElement>(null);
  const discarding = useRef(false);
  const visible = pageStack[pageStack.length - 1] === id;

  // Focus moves in when the drawer opens and back to what opened it when it closes.
  useEffect(() => {
    if (!open || !pageSlot || !visible) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const firstControl = ref.current?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)');
    (firstControl ?? ref.current)?.focus();
    return () => previous?.focus();
  }, [open, pageSlot, visible]);

  // An editing form that has opted in also keeps Escape working when a submit has left focus on
  // the page body (a disabled pending button drops it there). Only the topmost shown drawer
  // listens, and only for a key pressed on the body itself, so a dialog, popover or the page
  // keeps its own Escape.
  useEffect(() => {
    if (!open || !visible || !showPage || !guarded || confirming) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.target !== document.body) return;
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, visible, showPage, guarded, confirming, requestClose]);

  if (!open || !pageSlot) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.stopPropagation();
      if (!confirming) requestClose();
    }
  };

  // Discarding closes the confirmation first and the drawer only once it has gone, so the modal
  // confirmation releases the page (focus trap, pointer lock) before its parent unmounts and focus
  // returns to what opened the drawer.
  const discard = () => {
    discarding.current = true;
    setDirty(false);
    setConfirming(false);
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      hidden={!visible}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      data-page-drawer=""
      className={cx('relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-sm', visible ? undefined : 'hidden', className)}
    >
      {drawerLayout(children)}
      {guarded ? (
        <Dialog open={confirming} onOpenChange={(next) => { if (!next) setConfirming(false); }}>
          <DialogContent
            showCloseButton={false}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (discarding.current) {
                discarding.current = false;
                setOpen(false);
                return;
              }
              const target = returnFocus.current;
              (target?.isConnected && ref.current?.contains(target) ? target : ref.current)?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>Discard unsaved changes?</DialogTitle>
              <DialogDescription>Your changes in this panel have not been saved. Discarding closes it and keeps everything as it was.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" tone="secondary" size="small">Keep editing</Button>
              </DialogClose>
              <Button type="button" tone="danger" size="small" onClick={discard}>Discard changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      <button
        type="button"
        onClick={requestClose}
        className={cx(
          'absolute right-3 z-20 flex size-8 items-center justify-center rounded text-muted hover:bg-hover hover:text-foreground',
          DRAWER_CLOSE_OFFSET,
          FOCUS_RING,
        )}
      >
        <XIcon aria-hidden className="size-4" />
        <span className="sr-only">Close</span>
      </button>
    </div>,
    pageSlot,
  );
}

export function PageDrawerHeader({
  inline = false,
  className,
  ...props
}: ComponentProps<'div'> & { inline?: boolean }) {
  // `inline` puts a title and one secondary control on a single row; otherwise they stack.
  return (
    <div
      className={cx(
        'z-10 flex shrink-0 gap-0.5 border-b border-border bg-surface',
        DRAWER_HEADER,
        inline ? 'items-center justify-between gap-3' : 'flex-col justify-center',
        className,
      )}
      {...props}
    />
  );
}

export function PageDrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-drawer-footer="" className={cx('mt-auto flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface p-4', className)} {...props} />;
}

/** The body owns gutters and scrolling; headers and actions stay visible. */
export function PageDrawerBody({ className, padding = 'standard', ...props }: ComponentProps<'div'> & { padding?: 'standard' | 'none' }) {
  return <div data-drawer-body="" {...props} className={cx('min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain', padding === 'standard' && 'p-4', className)} />;
}

function drawerLayout(children: ReactNode) {
  const parts = Children.toArray(children);
  const isPart = (part: ReactNode, type: unknown) => isValidElement(part) && part.type === type;
  const header = parts.filter((part) => isPart(part, PageDrawerHeader));
  const footer = parts.filter((part) => isPart(part, PageDrawerFooter));
  const body = parts.filter((part) => !isPart(part, PageDrawerHeader) && !isPart(part, PageDrawerFooter));
  return <>{header}{body.some((part) => isPart(part, PageDrawerBody)) ? body : <PageDrawerBody className="space-y-4">{body}</PageDrawerBody>}{footer}</>;
}

export function PageDrawerTitle({ className, ...props }: ComponentProps<'h2'>) {
  const { titleId } = useDrawer();
  return (
    <h2
      id={titleId}
      className={cx('flex items-center text-base font-medium text-foreground', className)}
      {...props}
    />
  );
}

export function PageDrawerDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cx('text-sm text-muted', className)} {...props} />;
}
