'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Bot, Settings, X } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { cx, FOCUS_RING } from '@/components/class-names';

/**
 * Two independent panels beside the workspace, each with its own open state:
 *
 * - **Agent** is workspace-scoped and always the outermost right panel.
 * - **The page drawer** is page-scoped: Configure, and every create/edit form a page opens. It
 *   sits between the page and Agent. Its content is written by whoever opened it (`PageDrawer`)
 *   and portalled into the slot this host exposes, so it keeps its owner's state and context.
 *
 * Neither is modal: nothing dims, blurs or blocks the page behind them.
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
 * `phone` floats one from the bottom.
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

type RailContextValue = {
  layout: RailLayout;
  agentOpen: boolean;
  toggleAgent: () => void;
  closeAgent: () => void;
  configureOpen: boolean;
  setConfigureOpen: (open: boolean) => void;
  toggleConfigure: () => void;
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
  const [configureOpen, setConfigureOpen] = useState(false);
  const [agent, setAgent] = useState<ReactNode | null>(null);
  const [agentWidth, setAgentWidthState] = useState(readStoredWidth);
  const [pageSlot, setPageSlot] = useState<HTMLElement | null>(null);
  const [pageStack, setPageStack] = useState<string[]>([]);
  const [latest, setLatest] = useState<Panel>('page');

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
    setAgentOpen((open) => !open);
    setLatest('agent');
  }, []);
  const closeAgent = useCallback(() => setAgentOpen(false), []);
  const toggleConfigure = useCallback(() => setConfigureOpen((open) => !open), []);

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
      closeAgent,
      configureOpen,
      setConfigureOpen,
      toggleConfigure,
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
      closeAgent,
      configureOpen,
      toggleConfigure,
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
    <Button
      type="button"
      tone="secondary"
      size="small"
      aria-pressed={agentOpen}
      aria-label="Agent"
      onClick={toggleAgent}
      className={cx('gap-1.5 px-2 sm:px-3', agentOpen && 'bg-muted')}
    >
      <Bot aria-hidden size={16} />
      <span className="hidden sm:inline">Agent</span>
    </Button>
  );
}

/**
 * Configure is contextual to a page, so the page places this in its own `PageHeader` actions,
 * beside the `ConfigureRegistrar` whose drawer it opens. The page decides whether to offer it
 * (`mayConfigure`); that is presentation, never the guard — the panel's own writes are refused by
 * RLS regardless.
 */
export function ConfigureTrigger() {
  const { configureOpen, toggleConfigure } = useWorkspaceRail();

  return (
    <Button
      type="button"
      tone="secondary"
      aria-pressed={configureOpen}
      onClick={toggleConfigure}
      className={cx('gap-1.5', configureOpen && 'bg-muted')}
    >
      <Settings aria-hidden size={16} />
      Configure
    </Button>
  );
}

function panelClass(layout: RailLayout, shown: boolean): string {
  if (!shown) return 'hidden';
  const base = 'flex flex-col overflow-hidden bg-background';
  if (layout === 'wide' || layout === 'docked') {
    return cx(base, 'sticky top-0 h-svh shrink-0 self-start border-l border-border');
  }
  if (layout === 'overlay') {
    return cx(base, 'fixed inset-y-0 right-0 z-40 w-full max-w-md border-l border-border shadow-lg');
  }
  return cx(base, 'fixed inset-x-0 bottom-0 z-40 h-[85dvh] rounded-t-xl border-t border-border shadow-lg');
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

function AgentPanel() {
  const { layout, agent, agentOpen, showAgent, closeAgent, agentWidth } = useWorkspaceRail();
  // Mounted from first open and kept, so a conversation survives closing the panel.
  const [everOpened, setEverOpened] = useState(false);
  if (agentOpen && !everOpened) setEverOpened(true);

  const style: CSSProperties | undefined = docked(layout) ? { width: agentWidth } : undefined;

  return (
    <aside aria-label="Agent" className={cx('relative', panelClass(layout, showAgent))} style={style}>
      {docked(layout) ? <AgentResizeHandle /> : null}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">Agent</h2>
        <button
          type="button"
          onClick={closeAgent}
          aria-label="Close Agent"
          className={cx('rounded p-1 text-muted hover:bg-muted hover:text-foreground', FOCUS_RING)}
        >
          <X aria-hidden size={16} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{everOpened ? agent : null}</div>
    </aside>
  );
}

function PagePanel() {
  const { layout, showPage, setPageSlot } = useWorkspaceRail();
  const style: CSSProperties | undefined = docked(layout) ? { width: PAGE_DRAWER_WIDTH } : undefined;

  return (
    <aside
      ref={setPageSlot}
      aria-label="Page panel"
      className={panelClass(layout, showPage)}
      style={style}
    />
  );
}

/**
 * The single host for both panels. `main` never moves in the tree, so opening or closing a panel
 * never remounts the page. The same two elements serve every layout — only their classes change —
 * so resizing the window never remounts the drawer content either.
 */
export function WorkspaceRightRail({ main }: { main: ReactNode }) {
  return (
    <div className="flex min-h-svh w-full">
      <div className="min-w-0 flex-1">{main}</div>
      <PagePanel />
      <AgentPanel />
    </div>
  );
}
