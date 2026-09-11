'use client';

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cx, FOCUS_RING } from '../class-names';

const STORAGE_KEY = 'gold.sidebar-collapsed';
// `storage` only fires in *other* tabs (the browser's own rule) — this is what makes the tab
// that flipped the preference see it too, without a `useEffect`/`setState` pair reading an
// external source on mount, which is the pattern `react-hooks/set-state-in-effect` refuses.
const COLLAPSE_CHANGED = 'gold:sidebar-collapsed-changed';

function readCollapsed() {
  return window.localStorage.getItem(STORAGE_KEY) === '1';
}

function readCollapsedOnServer() {
  return false;
}

function subscribeToCollapsed(onChange: () => void) {
  window.addEventListener(COLLAPSE_CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(COLLAPSE_CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

function writeCollapsed(next: boolean) {
  window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  window.dispatchEvent(new Event(COLLAPSE_CHANGED));
}

const SidebarCollapsedContext = createContext(false);

/**
 * Whether the desktop sidebar has been manually collapsed to icon-only. Only ever true from
 * `lg` up — below that the tablet rail and the phone bar already have their own icon-only and
 * full-label states, and this preference does not reach them.
 */
export function useSidebarCollapsed() {
  return useContext(SidebarCollapsedContext);
}

/**
 * The text half of a sidebar row. `md:hidden lg:*` reproduces the tablet rail's icon-only
 * density without a separate rendering — hidden between `md` and `lg` always, hidden past `lg`
 * too once collapsed, visible everywhere else (including the phone bar, which never sets
 * `md:hidden` in the first place because it never reaches that breakpoint). `block` is for the
 * one caller stacking multiple lines (the identity block); every other row sits beside an icon
 * and wants `inline`.
 */
export function SidebarLabel({ children, block = false }: { children: ReactNode; block?: boolean }) {
  const collapsed = useSidebarCollapsed();
  const shown = block ? 'lg:block' : 'lg:inline';
  return (
    <span className={cx('min-w-0', collapsed ? 'md:hidden' : `md:hidden ${shown}`)}>{children}</span>
  );
}

/**
 * The shape a row in the sidebar takes, whatever that row does.
 *
 * **Deliberately not a `Button`, and it lives here for exactly that reason.** A `Button` carries
 * the action hierarchy (`ui-spec.md` §6): its tone says how much weight a control has on the
 * screen it sits on. A sidebar row has no weight to declare — it is the shell's furniture, the
 * same row whether it navigates, switches business or signs you out — so giving `Button` a tone
 * for it would put chrome into the vocabulary every screen reaches for.
 *
 * It sat beside the layout that renders it until the sign-out row was a raw `<button>` under
 * `app/`, which is the one thing M11 refuses. The rule is right and the row is right; what was
 * wrong is where it was written. A control is defined in the control set, and this is a control.
 */
export const SIDEBAR_ROW = cx(
  'flex items-center gap-2 rounded px-3 py-1.5 text-sm text-muted hover:bg-black/5 dark:hover:bg-white/10',
  FOCUS_RING,
);

/**
 * A sidebar row that does something rather than going somewhere — today, signing out.
 *
 * `w-full` is set here rather than in `SIDEBAR_ROW` because a `<button>` is the only caller that
 * needs it: an anchor with `display: flex` already fills its parent. `cx` resolves no Tailwind
 * conflict (see `class-names.ts`), so `className` is for a caller's own margins and nothing that
 * a row already sets.
 */
export function SidebarButton({ className, ...props }: ComponentProps<'button'>) {
  return <button {...props} className={cx(SIDEBAR_ROW, 'w-full', className)} />;
}

/**
 * The identity row at the top of the sidebar: a mark, and beside it the business's name once
 * there is room. Centers the mark on its own whenever the label has nowhere to go — the
 * icon-only tablet rail, or a manual collapse — rather than leaving it pinned to the row's own
 * padding while the rest of the column sits empty beside it.
 */
export function SidebarIdentity({ mark, label }: { mark: ReactNode; label: ReactNode }) {
  const collapsed = useSidebarCollapsed();
  return (
    <div
      className={cx(
        'flex items-center gap-3 border-b border-border px-4 py-4 md:justify-center',
        !collapsed && 'lg:justify-start',
      )}
    >
      {mark}
      {label}
    </div>
  );
}

/**
 * The two-column frame every operator screen renders inside: a fixed sidebar slot and a
 * scrolling main slot. Structure only — what goes in either slot, and whether it needs a brand
 * scope around it, is the caller's decision.
 *
 * Desktop's column remembers a manual collapse to icon-only, held in `localStorage`. It is a
 * preference, not a fourth rendering of the IA (`ui-spec.md` §2 still names three) — it never
 * applies below `lg`, and the one `AREAS` list is unaffected either way.
 */
export function AppShell({
  header,
  sidebar,
  sidebarFooter,
  bottomBar,
  children,
}: {
  header: ReactNode;
  sidebar: ReactNode;
  /** A persistent footer slot; the shell, not a page, owns its bottom placement. */
  sidebarFooter?: ReactNode;
  bottomBar?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useSyncExternalStore(subscribeToCollapsed, readCollapsed, readCollapsedOnServer);

  function toggle() {
    writeCollapsed(!collapsed);
  }

  return (
    <div
      className={cx(
        'min-h-full md:grid md:grid-cols-[5rem_1fr]',
        collapsed ? 'lg:grid-cols-[5rem_1fr]' : 'lg:grid-cols-[15rem_1fr]',
      )}
    >
      {/*
        The rail is tablet and desktop only. It used to render on a phone too, stacking the
        business's identity and the shell's own actions above every screen — so a phone showed
        two bands of chrome before any content, and the areas a third time in the bar at the
        bottom. The areas are the bottom bar there and the actions are in the header, which
        leaves nothing for this column to hold at that width.
      */}
      <aside className="hidden md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:overflow-hidden md:border-r md:border-border">
        <SidebarCollapsedContext.Provider value={collapsed}>
          {sidebar}
          <footer className="mt-auto shrink-0 border-t border-border">
            {sidebarFooter}
            <button
              type="button"
              onClick={toggle}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={cx(
                'hidden w-full items-center gap-2 px-4 py-3 text-sm text-muted hover:bg-black/5 dark:hover:bg-white/10 lg:flex',
                collapsed ? 'justify-center' : 'justify-start',
                FOCUS_RING,
              )}
            >
              {collapsed ? (
                <PanelLeftOpen aria-hidden size={18} className="shrink-0" />
              ) : (
                <PanelLeftClose aria-hidden size={18} className="shrink-0" />
              )}
              <SidebarLabel>Collapse</SidebarLabel>
            </button>
          </footer>
        </SidebarCollapsedContext.Provider>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/*
          Sticky, because *where am I* is the question it answers and scrolling a long list of
          jobs is exactly when it stops being obvious. It carries its own background: the page
          scrolls underneath it, and a transparent bar would show the rows sliding through the
          text.
        */}
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-border bg-background px-4 sm:px-6">
          {header}
        </header>

        {/* `pb-24` on phones reserves room for the fixed bottom bar; from `md` it is a column and this goes away. */}
        <main className="min-w-0 flex-1 p-4 pb-24 sm:p-6 md:pb-6 lg:p-8">{children}</main>
      </div>

      {/* Outside the grid's two cells: it is `fixed` on a phone and renders nothing above `md`. */}
      {bottomBar}
    </div>
  );
}
