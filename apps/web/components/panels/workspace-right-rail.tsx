'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { BarChart3, Bot, History, Settings, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@gold/ui/components/tooltip';
import { VisualPortalScope } from '@gold/ui/components/visual-scope';
import { cx, FOCUS_RING } from '@/components/class-names';
import { HEADER_HEIGHT_STYLE, MOBILE_NAV_HEIGHT_STYLE } from '../layout/workspace-geometry';

/**
 * Two independent panels beside the workspace, each with its own open state:
 *
 * - **Agent** is workspace-scoped and always the outermost right panel. Its header is the
 *   workspace header's band.
 * - **The page-support rail** is page-scoped: one of Activity, Insights or Configure (a
 *   `SupportMode`), and every create/edit form a page opens. It sits between the page and Agent,
 *   beneath the workspace header, and its header aligns with the page's (`workspace-geometry.ts`).
 *   Its content is written by whoever opened it (`PageDrawer`) and portalled into the one slot
 *   `PagePanel` exposes, so it keeps its owner's state and context. **One mode is open at a time**:
 *   `supportMode` is a single value, so choosing another mode replaces the open one in the same
 *   footprint instead of stacking a second drawer.
 *
 * Agent is modal only on phones. Page-support panels remain nonmodal.
 */

const AGENT_MIN_WIDTH = 320;
const AGENT_MAX_WIDTH = 600;
const AGENT_DEFAULT_WIDTH = 380;
const AGENT_WIDTH_STORAGE_KEY = 'gold.workspace-rail.width';
const PAGE_DRAWER_WIDTH = 448;
const RESIZE_STEP = 24;

/**
 * Four layouts by viewport width. `wide` docks both panels beside the page; `docked` docks one
 * (the one opened last, when both are open); `overlay` floats one over the page from the right;
 * `phone` makes Agent fullscreen while page-support panels float from the bottom.
 */
const WIDE_BREAKPOINT = 1720;
const DOCK_BREAKPOINT = 1280;
const TABLET_BREAKPOINT = 768;

type RailLayout = 'wide' | 'docked' | 'overlay' | 'phone';

function computeLayout(): RailLayout {
  if (window.innerWidth >= WIDE_BREAKPOINT) return 'wide';
  if (window.innerWidth >= DOCK_BREAKPOINT) return 'docked';
  if (window.innerWidth >= TABLET_BREAKPOINT) return 'overlay';
  return 'phone';
}

function subscribeToLayout(onChange: () => void) {
  const queries = [WIDE_BREAKPOINT, DOCK_BREAKPOINT, TABLET_BREAKPOINT].map((width) =>
    window.matchMedia(`(min-width: ${width}px)`),
  );
  for (const query of queries) query.addEventListener('change', onChange);
  return () => {
    for (const query of queries) query.removeEventListener('change', onChange);
  };
}

function useRailLayout(): RailLayout {
  return useSyncExternalStore(subscribeToLayout, computeLayout, () => 'phone');
}

function readStoredWidth(): number {
  if (typeof window === 'undefined') return AGENT_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(AGENT_WIDTH_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return Math.min(AGENT_MAX_WIDTH, Math.max(AGENT_MIN_WIDTH, parsed));
  } catch {
    // Convenience-only persistence — a blocked or private store just falls back to the default.
  }
  return AGENT_DEFAULT_WIDTH;
}

type Panel = 'agent' | 'page';

/** What the page-support rail can show, in the order a page header offers it. */
export const SUPPORT_MODES = ['activity', 'insights', 'configure'] as const;
export type SupportMode = (typeof SUPPORT_MODES)[number];

const SUPPORT_MODE_LABELS: Record<SupportMode, { label: string; icon: LucideIcon }> = {
  activity: { label: 'Activity', icon: History },
  insights: { label: 'Insights', icon: BarChart3 },
  configure: { label: 'Settings', icon: Settings },
};

type RailContextValue = {
  layout: RailLayout;
  agentOpen: boolean;
  toggleAgent: () => void;
  openAgent: (returnFocus?: HTMLElement | null) => void;
  agentReturnFocus: RefObject<HTMLElement | null>;
  launchAgent: (prompt: string) => void;
  agentLaunch: { id: number; prompt: string } | null;
  closeAgent: () => void;
  /** The one open page-support mode, or null. Never two. */
  supportMode: SupportMode | null;
  setSupportMode: (mode: SupportMode | null | ((current: SupportMode | null) => SupportMode | null)) => void;
  toggleSupport: (mode: SupportMode) => void;
  agent: ReactNode | null;
  registerAgent: (content: ReactNode | null) => void;
  agentWidth: number;
  setAgentWidth: (width: number) => void;
  pageSlot: HTMLElement | null;
  setPageSlot: (element: HTMLElement | null) => void;
  pageStack: string[];
  openPage: (id: string) => void;
  closePage: (id: string) => void;
  showAgent: boolean;
  showPage: boolean;
};

const RailContext = createContext<RailContextValue | null>(null);

export function WorkspaceRailProvider({ children }: { children: ReactNode }) {
  const layout = useRailLayout();
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentLaunch, setAgentLaunch] = useState<{ id: number; prompt: string } | null>(null);
  const [supportMode, setSupportMode] = useState<SupportMode | null>(null);
  const [agent, setAgent] = useState<ReactNode | null>(null);
  const [agentWidth, setAgentWidthState] = useState(readStoredWidth);
  const [pageSlot, setPageSlot] = useState<HTMLElement | null>(null);
  const [pageStack, setPageStack] = useState<string[]>([]);
  const [latest, setLatest] = useState<Panel>('page');
  const agentReturnFocus = useRef<HTMLElement | null>(null);
  const openAgent = useCallback((returnFocus?: HTMLElement | null) => {
    agentReturnFocus.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setAgentOpen(true);
    setLatest('agent');
  }, []);
  const launchAgent = useCallback((prompt: string) => {
    setAgentLaunch({ id: Date.now(), prompt: prompt.slice(0, 1900) });
    openAgent();
  }, [openAgent]);

  const setAgentWidth = useCallback((next: number) => {
    const clamped = Math.min(AGENT_MAX_WIDTH, Math.max(AGENT_MIN_WIDTH, next));
    setAgentWidthState(clamped);
    try {
      window.localStorage.setItem(AGENT_WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Convenience only.
    }
  }, []);

  const registerAgent = useCallback((content: ReactNode | null) => setAgent(content), []);

  const toggleAgent = useCallback(() => {
    if (agentOpen) setAgentOpen(false);
    else openAgent();
  }, [agentOpen, openAgent]);
  const closeAgent = useCallback(() => setAgentOpen(false), []);
  const toggleSupport = useCallback(
    (mode: SupportMode) => setSupportMode((current) => (current === mode ? null : mode)),
    [],
  );

  const openPage = useCallback((id: string) => {
    setPageStack((stack) => (stack.includes(id) ? stack : [...stack, id]));
    setLatest('page');
  }, []);
  const closePage = useCallback((id: string) => {
    setPageStack((stack) => stack.filter((entry) => entry !== id));
  }, []);

  const pageOpen = pageStack.length > 0;
  // Where both cannot sit beside the page, the one opened last is the one shown; closing it
  // brings the other back.
  const both = agentOpen && pageOpen;
  const roomForBoth = layout === 'wide';
  const showAgent = agentOpen && (!both || roomForBoth || latest === 'agent');
  const showPage = pageOpen && (!both || roomForBoth || latest === 'page');

  const value = useMemo<RailContextValue>(
    () => ({
      layout,
      agentOpen,
      toggleAgent,
      openAgent,
      agentReturnFocus,
      launchAgent,
      agentLaunch,
      closeAgent,
      supportMode,
      setSupportMode,
      toggleSupport,
      agent,
      registerAgent,
      agentWidth,
      setAgentWidth,
      pageSlot,
      setPageSlot,
      pageStack,
      openPage,
      closePage,
      showAgent,
      showPage,
    }),
    [
      layout,
      agentOpen,
      toggleAgent,
      openAgent,
      closeAgent,
      supportMode,
      toggleSupport,
      agent,
      registerAgent,
      agentWidth,
      setAgentWidth,
      pageSlot,
      pageStack,
      openPage,
      closePage,
      showAgent,
      showPage,
      launchAgent,
      agentLaunch,
    ],
  );

  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
}

export function useWorkspaceRail() {
  const context = useContext(RailContext);
  if (!context) throw new Error('useWorkspaceRail must be used within WorkspaceRailProvider');
  return context;
}

/** Registers what the Agent panel shows. Set once, near the shell root — see `AgentRailContent`. */
export function useAgentContent(content: ReactNode | null) {
  const { registerAgent } = useWorkspaceRail();
  useEffect(() => {
    registerAgent(content);
    return () => registerAgent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);
}

/**
 * The workspace-global Agent control — the far-right end of `WorkspaceHeader`. Agent is scoped to
 * the workspace, never to a page, so it is never rendered by a `PageHeader`.
 */
export function AgentTrigger() {
  const { agentOpen, toggleAgent } = useWorkspaceRail();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          tone="secondary"
          size="small"
          aria-pressed={agentOpen}
          aria-label="Agent"
          onClick={toggleAgent}
          className="size-9 p-0 [&_svg]:size-5"
        >
          <Bot aria-hidden size={20} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Agent</TooltipContent>
    </Tooltip>
  );
}

/**
 * The trigger for one page-support mode, placed by `PageHeader` and nowhere else, beside the
 * registrar (`SupportRegistrar`) whose drawer it opens. Pressing the open mode closes it; pressing
 * another switches the rail to that one. The page decides which modes it offers; that is
 * presentation, never the guard — the panel's own reads and writes are refused by RLS regardless.
 */
export function SupportTrigger({ mode, size }: { mode: SupportMode; size?: import('../controls/button').ButtonSize }) {
  const { supportMode, toggleSupport } = useWorkspaceRail();
  const { label, icon: Icon } = SUPPORT_MODE_LABELS[mode];

  return (
    <Button
      type="button"
      tone="secondary"
      size={size}
      aria-pressed={supportMode === mode}
      onClick={() => toggleSupport(mode)}
      className="gap-1.5"
    >
      <Icon aria-hidden size={16} />
      {label}
    </Button>
  );
}

/**
 * Where each panel sits, in every layout. Agent is workspace-global: it runs the full height and
 * its header takes the workspace header's band. The page panel is page-local: it starts beneath
 * that band (it is rendered inside `AppShell`, under the header), so its own header lines up with
 * the page's. The header height is `--header-height`, set once on the rail root.
 */
function panelClass(panel: Panel, layout: RailLayout, shown: boolean): string {
  if (!shown) return 'hidden';
  const global = panel === 'agent';
  const base = 'flex flex-col overflow-hidden bg-background';
  if (layout === 'wide' || layout === 'docked') {
    return cx(
      base,
      'shrink-0 self-start border-l border-border',
      global ? 'sticky top-0 h-svh' : 'sticky top-(--header-height) h-[calc(100svh-var(--header-height))]',
    );
  }
  if (layout === 'overlay') {
    return cx(
      base,
      'fixed right-0 bottom-0 z-40 w-full max-w-md border-l border-border shadow-lg',
      global ? 'top-0 left-auto h-dvh' : 'top-(--header-height)',
    );
  }
  if (global) return cx(base, 'fixed inset-x-0 top-0 z-50 h-dvh w-full overscroll-none');
  return cx(
    base,
    'fixed inset-x-0 bottom-[var(--mobile-nav-height,0px)] z-40 rounded-t-xl border-t border-border shadow-lg',
    'h-[min(85dvh,calc(100dvh-var(--header-height)))] max-h-[calc(100dvh-var(--header-height)-var(--mobile-nav-height,0px))]',
  );
}

function docked(layout: RailLayout) {
  return layout === 'wide' || layout === 'docked';
}

function AgentResizeHandle() {
  const { agentWidth, setAgentWidth } = useWorkspaceRail();

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const move = (next: PointerEvent) => setAgentWidth(window.innerWidth - next.clientX);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') setAgentWidth(agentWidth + RESIZE_STEP);
    if (event.key === 'ArrowRight') setAgentWidth(agentWidth - RESIZE_STEP);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Agent"
      aria-valuenow={agentWidth}
      aria-valuemin={AGENT_MIN_WIDTH}
      aria-valuemax={AGENT_MAX_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cx(
        'absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize touch-none hover:bg-border',
        FOCUS_RING,
      )}
    />
  );
}

function subscribeToVisualViewport(onChange: () => void) {
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', onChange);
  viewport?.addEventListener('scroll', onChange);
  window.addEventListener('resize', onChange);
  return () => {
    viewport?.removeEventListener('resize', onChange);
    viewport?.removeEventListener('scroll', onChange);
    window.removeEventListener('resize', onChange);
  };
}

function visualViewportSnapshot() {
  const viewport = window.visualViewport;
  return `${viewport?.height ?? window.innerHeight}:${viewport?.offsetTop ?? 0}`;
}

function AgentPanel() {
  const { layout, agent, agentOpen, showAgent, closeAgent, agentWidth, agentReturnFocus } = useWorkspaceRail();
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const wasModal = useRef(false);
  const phone = layout === 'phone';
  const viewport = useSyncExternalStore(subscribeToVisualViewport, visualViewportSnapshot, () => '0:0');
  const [viewportHeight, viewportTop] = viewport.split(':').map(Number);
  // Mounted from first open and kept, so a conversation survives closing the panel.
  const [everOpened, setEverOpened] = useState(false);
  if (agentOpen && !everOpened) setEverOpened(true);

  const style: CSSProperties | undefined = docked(layout) ? { width: agentWidth }
    : phone && viewportHeight ? { height: viewportHeight, top: viewportTop } : undefined;

  useLayoutEffect(() => {
    if (!dialog) return;
    const modal = phone && showAgent;
    const focused = dialog.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    if (dialog.open && (!showAgent || wasModal.current !== modal)) dialog.close();
    if (showAgent && !dialog.open) {
      if (modal) dialog.showModal();
      else dialog.setAttribute('open', '');
      if (focused) focused.focus();
    }
    if (wasModal.current && !showAgent) agentReturnFocus.current?.focus();
    wasModal.current = modal;
  }, [dialog, phone, showAgent, agentReturnFocus]);

  return (
    <dialog ref={setDialog} role={phone ? 'dialog' : 'complementary'} aria-label="Agent" aria-modal={phone && showAgent ? true : undefined}
      onCancel={(event) => { event.preventDefault(); closeAgent(); }}
      className={cx('m-0 max-h-none border-0 p-0 text-foreground outline-none', layout !== 'overlay' && 'max-w-none', panelClass('agent', layout, showAgent), phone && 'pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]')}
      style={style}>
      <VisualPortalScope container={dialog}>
      {docked(layout) ? <AgentResizeHandle /> : null}
      <div className="flex h-(--header-height) shrink-0 items-center gap-3 border-b border-border px-4">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Agent</h2>
        <button
          type="button"
          onClick={closeAgent}
          aria-label="Close Agent"
          className={cx('flex size-10 shrink-0 items-center justify-center rounded text-muted hover:bg-hover hover:text-foreground', FOCUS_RING)}
        >
          <X aria-hidden size={16} />
        </button>
      </div>
      {/* Not a scroll container: the transcript's `MessageScroller` is the one thing in Agent that scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{everOpened ? agent : null}</div>
      </VisualPortalScope>
    </dialog>
  );
}

/** Rendered by `AppShell`, beneath the workspace header and beside the page — never by the rail. */
export function PagePanel() {
  const { layout, showPage, setPageSlot } = useWorkspaceRail();
  const style: CSSProperties | undefined = docked(layout) ? { width: PAGE_DRAWER_WIDTH } : undefined;

  return (
    <aside
      ref={setPageSlot}
      aria-label="Page panel"
      className={panelClass('page', layout, showPage)}
      style={style}
    />
  );
}

/**
 * The workspace row: the whole shell (`main`, which hosts the page panel under its own header) and
 * Agent beside it. `main` never moves in the tree, so opening or closing a panel never remounts
 * the page, and the same two elements serve every layout — only their classes change. It owns
 * `--header-height`, so Agent's header and the workspace header are one band.
 */
export function WorkspaceRightRail({ main, bottomInset = false }: { main: ReactNode; /** True when the shell draws a persistent phone bottom bar; panels then stop above it. */ bottomInset?: boolean }) {
  return (
    <div className="flex min-h-svh w-full" style={HEADER_HEIGHT_STYLE}>
      {/* `contents` draws no box; it only carries `--mobile-nav-height` to both the page and Agent. */}
      <div className="contents" style={bottomInset ? MOBILE_NAV_HEIGHT_STYLE : undefined}>
        <div className="min-w-0 flex-1">{main}</div>
        <AgentPanel />
      </div>
    </div>
  );
}
