'use client';

import {
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
import { cx, FOCUS_RING } from '../class-names';
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
 */

type DrawerContextValue = {
  id: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
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

  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setOwnOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  useEffect(() => {
    if (!open) return;
    openPage(id);
    return () => closePage(id);
  }, [open, id, openPage, closePage]);

  return <DrawerContext.Provider value={{ id, open, setOpen, titleId }}>{children}</DrawerContext.Provider>;
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
  const { setOpen } = useDrawer();
  const { asChild, ...rest } = props;
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      type={asChild ? undefined : 'button'}
      {...rest}
      onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
        rest.onClick?.(event);
        if (!event.defaultPrevented) setOpen(false);
      }}
    >
      {children}
    </Component>
  );
}

export function PageDrawerContent({ className, children }: { className?: string; children: ReactNode }) {
  const { id, open, setOpen, titleId } = useDrawer();
  const { pageSlot, pageStack } = useWorkspaceRail();
  const ref = useRef<HTMLDivElement>(null);
  const visible = pageStack[pageStack.length - 1] === id;

  // Focus moves in when the drawer opens and back to what opened it when it closes.
  useEffect(() => {
    if (!open || !pageSlot || !visible) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current
      ?.querySelector<HTMLElement>('[data-autofocus], input:not([type=hidden]), select, textarea')
      ?.focus();
    return () => previous?.focus();
  }, [open, pageSlot, visible]);

  if (!open || !pageSlot) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      hidden={!visible}
      onKeyDown={onKeyDown}
      className={cx('relative flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto text-sm', visible ? undefined : 'hidden', className)}
    >
      {children}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className={cx(
          'absolute right-3 flex size-8 items-center justify-center rounded text-muted hover:bg-hover hover:text-foreground',
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
        'flex gap-0.5',
        DRAWER_HEADER,
        inline ? 'items-center justify-between gap-3' : 'flex-col justify-center',
        className,
      )}
      {...props}
    />
  );
}

export function PageDrawerFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cx('mt-auto flex flex-col gap-2 p-4', className)} {...props} />;
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
