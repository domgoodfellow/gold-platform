'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, Settings, X } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { Sheet, SheetContent } from '@gold/ui/components/sheet';
import { cx, FOCUS_RING } from '@/components/class-names';

/**
 * One right-side host, one mode at a time (never stacked). "Agent" and "Configure" share it;
 * switching modes never unmounts the other's subtree, so an in-progress conversation survives a
 * trip through Configure and back.
 */
type RailMode = 'closed' | 'agent' | 'configure';

type ConfigurePanel = {
  title: string;
  /** Where "Open full settings" lands — the exact Settings route/tab this panel mirrors. */
  settingsHref: string;
  content: ReactNode;
};

type RailContextValue = {
  mode: RailMode;
  openAgent: () => void;
  openConfigure: () => void;
  close: () => void;
  toggleAgent: () => void;
  toggleConfigure: () => void;
  configure: ConfigurePanel | null;
  registerConfigure: (panel: ConfigurePanel | null) => void;
  agent: ReactNode | null;
  registerAgent: (content: ReactNode | null) => void;
  width: number;
  setWidth: (width: number) => void;
};

const RailContext = createContext<RailContextValue | null>(null);

const MIN_WIDTH = 320;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 380;
const WIDTH_STORAGE_KEY = 'gold.workspace-rail.width';

function readStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed)) return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed));
  } catch {
    // Convenience-only persistence — a blocked or private store just falls back to the default.
  }
  return DEFAULT_WIDTH;
}

/** lg and up docks the rail inline; below that it is an overlay Sheet. */
const DOCK_BREAKPOINT = 1024;

function subscribeToDock(onChange: () => void) {
  const mql = window.matchMedia(`(min-width: ${DOCK_BREAKPOINT}px)`);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function useIsDocked() {
  return useSyncExternalStore(
    subscribeToDock,
    () => window.innerWidth >= DOCK_BREAKPOINT,
    () => false,
  );
}

export function WorkspaceRailProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<RailMode>('closed');
  const [configure, setConfigure] = useState<ConfigurePanel | null>(null);
  const [agent, setAgent] = useState<ReactNode | null>(null);
  const [width, setWidthState] = useState(readStoredWidth);

  const setWidth = useCallback((next: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
    setWidthState(clamped);
    try {
      window.localStorage.setItem(WIDTH_STORAGE_KEY, String(clamped));
    } catch {
      // Convenience only.
    }
  }, []);

  const registerConfigure = useCallback((panel: ConfigurePanel | null) => {
    setConfigure(panel);
  }, []);

  const registerAgent = useCallback((content: ReactNode | null) => {
    setAgent(content);
  }, []);

  const openAgent = useCallback(() => setMode('agent'), []);
  const openConfigure = useCallback(() => setMode('configure'), []);
  const close = useCallback(() => setMode('closed'), []);
  const toggleAgent = useCallback(() => setMode((m) => (m === 'agent' ? 'closed' : 'agent')), []);
  const toggleConfigure = useCallback(
    () => setMode((m) => (m === 'configure' ? 'closed' : 'configure')),
    [],
  );

  // A page that unmounts its Configure registration while Configure is the open mode (navigating
  // away from the workspace that owned it) reads as closed rather than showing a stale panel —
  // derived here rather than synchronized back into `mode` with an effect, so there is nothing to
  // cascade.
  const effectiveMode = mode === 'configure' && configure === null ? 'closed' : mode;

  const value = useMemo<RailContextValue>(
    () => ({
      mode: effectiveMode,
      openAgent,
      openConfigure,
      close,
      toggleAgent,
      toggleConfigure,
      configure,
      registerConfigure,
      agent,
      registerAgent,
      width,
      setWidth,
    }),
    [effectiveMode, openAgent, openConfigure, close, toggleAgent, toggleConfigure, configure, registerConfigure, agent, registerAgent, width, setWidth],
  );

  return <RailContext.Provider value={value}>{children}</RailContext.Provider>;
}

export function useWorkspaceRail() {
  const context = useContext(RailContext);
  if (!context) throw new Error('useWorkspaceRail must be used within WorkspaceRailProvider');
  return context;
}

/**
 * A page registers what its Configure button opens. The effect's cleanup un-registers on
 * navigation away, which is what makes the header's Configure button disappear on a workspace
 * that has none.
 *
 * **Callers must pass a `panel` that is referentially stable across re-renders that carry no new
 * data** (`useMemo`d on `title`/`settingsHref`/`content` — see `ConfigureRegistrar`). This
 * component re-renders on every rail-context change (it reads the context to register at all),
 * so an unmemoized object literal here would re-run the effect, and therefore `setState` in the
 * provider, on every one of those — an infinite loop. A stable reference both avoids that and
 * still picks up a genuine change (e.g. the page's own data revalidating with new content).
 */
export function useConfigurePanel(panel: ConfigurePanel | null) {
  const { registerConfigure } = useWorkspaceRail();
  useEffect(() => {
    registerConfigure(panel);
    return () => registerConfigure(null);
  }, [panel, registerConfigure]);
}

/** Registers what the Agent rail shows. Set once, near the shell root — see `AgentRailContent`. */
export function useAgentContent(content: ReactNode | null) {
  const { registerAgent } = useWorkspaceRail();
  useEffect(() => {
    registerAgent(content);
    return () => registerAgent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);
}

/** The two furthest-right header controls. Configure only renders when a page has registered one. */
export function WorkspaceHeaderActions() {
  const { mode, configure, toggleAgent, toggleConfigure } = useWorkspaceRail();

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {configure ? (
        <Button
          type="button"
          tone="secondary"
          size="small"
          aria-pressed={mode === 'configure'}
          aria-label="Configure"
          onClick={toggleConfigure}
          className={cx('gap-1.5 px-2 sm:px-3', mode === 'configure' && 'bg-muted')}
        >
          <Settings aria-hidden size={16} />
          <span className="hidden sm:inline">Configure</span>
        </Button>
      ) : null}
      <Button
        type="button"
        tone="secondary"
        size="small"
        aria-pressed={mode === 'agent'}
        aria-label="Agent"
        onClick={toggleAgent}
        className={cx('gap-1.5 px-2 sm:px-3', mode === 'agent' && 'bg-muted')}
      >
        <Bot aria-hidden size={16} />
        <span className="hidden sm:inline">Agent</span>
      </Button>
    </div>
  );
}

function RailHeader({
  title,
  onClose,
  settingsHref,
}: {
  title: string;
  onClose: () => void;
  settingsHref?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
      {settingsHref ? (
        <Link
          href={settingsHref}
          className={cx('flex items-center gap-1 text-xs text-muted underline-offset-4 hover:underline', FOCUS_RING)}
        >
          Open full settings
          <ArrowRight aria-hidden size={12} />
        </Link>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className={cx('rounded p-1 text-muted hover:bg-muted hover:text-foreground', FOCUS_RING)}
      >
        <X aria-hidden size={16} />
      </button>
    </div>
  );
}

function RailBody({ mode, configure, agent }: { mode: RailMode; configure: ConfigurePanel | null; agent: ReactNode | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Both subtrees stay mounted; only visibility toggles, so Agent's conversation state
          (and any in-progress Configure edits) survive switching modes. */}
      <div hidden={mode !== 'agent'} className="flex min-h-0 flex-1 flex-col">
        {agent}
      </div>
      <div hidden={mode !== 'configure'} className="flex min-h-0 flex-1 flex-col p-4">
        {configure?.content}
      </div>
    </div>
  );
}

function ResizeHandle({ onResize }: { onResize: (delta: number) => void }) {
  const dragging = useRef(false);

  useEffect(() => {
    function handleMove(event: MouseEvent) {
      if (!dragging.current) return;
      onResize(-event.movementX);
    }
    function handleUp() {
      dragging.current = false;
    }
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [onResize]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      onMouseDown={() => {
        dragging.current = true;
      }}
      className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-border active:bg-border"
    />
  );
}

/**
 * The single rail host: docked beside the workspace from `lg` up, an overlay Sheet below it.
 * Content (Agent, Configure) is supplied by whoever registered it — this component owns only the
 * mode switch, the dock/overlay choice, and the resize handle.
 */
export function WorkspaceRightRail() {
  const { mode, close, configure, agent, width, setWidth } = useWorkspaceRail();
  const isDocked = useIsDocked();
  const open = mode !== 'closed';
  const title = mode === 'agent' ? 'Agent' : (configure?.title ?? 'Configure');

  if (isDocked) {
    if (!open) return null;
    return (
      // `sticky` + an explicit viewport-relative height, rather than relying on flex stretch
      // matching its row sibling — the workspace column can render far taller than the viewport
      // (a long Work list), and stretch would have made the rail that tall too: real, but
      // scrolled out of view along with the rest of the page, so nothing in it was ever visible.
      <div className="sticky top-0 flex h-svh shrink-0" style={{ width }}>
        <ResizeHandle onResize={(delta) => setWidth(width + delta)} />
        <aside
          aria-label={title}
          className="flex min-h-0 flex-1 flex-col border-l border-border bg-background"
        >
          <RailHeader title={title} onClose={close} settingsHref={mode === 'configure' ? configure?.settingsHref : undefined} />
          <RailBody mode={mode} configure={configure} agent={agent} />
        </aside>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent side="bottom" showCloseButton={false} className="flex h-[85vh] flex-col gap-0 p-0">
        <RailHeader title={title} onClose={close} settingsHref={mode === 'configure' ? configure?.settingsHref : undefined} />
        <RailBody mode={mode} configure={configure} agent={agent} />
      </SheetContent>
    </Sheet>
  );
}
