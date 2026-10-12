// @vitest-environment jsdom
import { useEffect, useMemo } from 'react';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentTrigger,
  WorkspaceRailProvider,
  WorkspaceRightRail,
  useAgentContent,
  useWorkspaceRail,
} from '@/components/panels/workspace-right-rail';

/**
 * Agent's trigger and its lazy-mount contract (Phase C, Slice 12): the pressed state the global
 * header control shows, and that the registered Agent content — `TenantAgentRail`'s real shape in
 * the app, a probe here — is not mounted at all until the panel is opened for the first time, and
 * stays mounted across a close/reopen rather than remounting (which is what would re-trigger
 * `loadAgentBootstrapAction` on every reopen if it ever regressed).
 *
 * This exercises the real exported `WorkspaceRailProvider`/`WorkspaceRightRail`/`AgentTrigger`/
 * `useAgentContent` — not a reimplementation of the rail — so a regression in the actual
 * lazy-mount wiring fails here.
 */

const layoutListeners = new Set<() => void>();
function resize(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  act(() => { layoutListeners.forEach((listener) => listener()); window.dispatchEvent(new Event('resize')); });
}
beforeEach(() => {
  layoutListeners.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout engine and no `matchMedia`; the rail's own breakpoint hook only needs
  // the call to exist, never fire a real change here.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: (_event: string, listener: () => void) => layoutListeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => layoutListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function AgentProbe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <div data-testid="agent-content">Ask about this business…<textarea aria-label="Draft" /></div>;
}

function ExplicitOpen() {
  const { openAgent, launchAgent } = useWorkspaceRail();
  return <><button onClick={(event) => openAgent(event.currentTarget)}>Show Agent</button><button onClick={() => launchAgent('Opening prompt')}>Launch Agent</button></>;
}

function RegisterAgentContent({ onMount }: { onMount: () => void }) {
  // Memoized the same way `TenantAgentRail` memoizes its own content: `useAgentContent`'s effect
  // is keyed on this element's identity, and a fresh element every render would re-register (and
  // in the app, re-fetch) on every unrelated rail state change rather than once on first open.
  const content = useMemo(() => <AgentProbe onMount={onMount} />, [onMount]);
  useAgentContent(content);
  return null;
}

function Harness({ onMount }: { onMount: () => void }) {
  return (
    <TooltipProvider>
      <WorkspaceRailProvider>
        <AgentTrigger />
        <ExplicitOpen />
        <WorkspaceRightRail main={<div>The page</div>} />
        <RegisterAgentContent onMount={onMount} />
      </WorkspaceRailProvider>
    </TooltipProvider>
  );
}

describe('Agent trigger and lazy-mount lifecycle', () => {
  it('starts closed: aria-pressed is false and the registered content has never mounted', () => {
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);

    expect(screen.getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-pressed', 'false');
    expect(onMount).not.toHaveBeenCalled();
    expect(screen.queryByTestId('agent-content')).not.toBeInTheDocument();
  });

  it('opening presses the trigger and mounts the content for the first time', async () => {
    const user = userEvent.setup();
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);

    await user.click(screen.getByRole('button', { name: 'Agent' }));

    expect(screen.getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-pressed', 'true');
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('agent-content')).toBeInTheDocument();
  });

  it('closing un-presses the trigger and hides the panel, without unmounting the content', async () => {
    const user = userEvent.setup();
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);

    await user.click(screen.getByRole('button', { name: 'Agent' }));
    expect(onMount).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Agent' }));
    expect(screen.getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-pressed', 'false');
    // Closed means hidden, not removed — `AgentPanel` keeps the
    // subtree mounted once `everOpened` is true, which is what lets a conversation survive
    // closing the panel without a new bootstrap fetch on reopen.
    expect(screen.getByTestId('agent-content')).toBeInTheDocument();
  });

  it('reopening presses the trigger again without mounting the content a second time', async () => {
    const user = userEvent.setup();
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);

    await user.click(screen.getByRole('button', { name: 'Agent' })); // open
    await user.click(screen.getByRole('button', { name: 'Agent' })); // close
    await user.click(screen.getByRole('button', { name: 'Agent' })); // reopen

    expect(screen.getByRole('button', { name: 'Agent' })).toHaveAttribute('aria-pressed', 'true');
    // Still exactly once: reopening must not look like a fresh bootstrap to whatever registered
    // this content (`TenantAgentRail`'s real `everOpened` guard, in the app).
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('preserves the same draft and mounted subtree across phone, tablet, desktop and close/reopen', async () => {
    resize(390);
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);
    const opener = screen.getByRole('button', { name: 'Show Agent' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Agent' })).toHaveAttribute('aria-modal', 'true');
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    await userEvent.type(draft, 'Unsent draft');
    resize(768);
    expect(screen.getByRole('complementary', { name: 'Agent' })).not.toHaveAttribute('aria-modal');
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
    resize(1440);
    expect(screen.getByRole('separator', { name: 'Resize Agent' })).toBeInTheDocument();
    resize(390);
    await userEvent.click(screen.getByRole('button', { name: 'Close Agent' }));
    expect(opener).toHaveFocus();
    await userEvent.click(opener);
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
    expect(draft).toHaveValue('Unsent draft');
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('explicit opening and launch requests bring an existing Agent into view without toggling it closed', async () => {
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show Agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show Agent' }));
    await userEvent.click(screen.getByRole('button', { name: 'Launch Agent' }));
    expect(screen.getByRole('complementary', { name: 'Agent' })).toHaveAttribute('open');
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('responds to simulated visual-viewport shrink and offset without replacing the draft', async () => {
    resize(390);
    const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0 });
    vi.stubGlobal('visualViewport', viewport);
    const onMount = vi.fn();
    render(<Harness onMount={onMount} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show Agent' }));
    const draft = screen.getByRole('textbox', { name: 'Draft' });
    await userEvent.type(draft, 'Keep while typing');
    act(() => { viewport.height = 460; viewport.offsetTop = 36; viewport.dispatchEvent(new Event('resize')); });
    expect(screen.getByRole('dialog', { name: 'Agent' })).toHaveStyle({ height: '460px', top: '36px' });
    expect(screen.getByRole('textbox', { name: 'Draft' })).toBe(draft);
    expect(draft).toHaveValue('Keep while typing');
    expect(onMount).toHaveBeenCalledTimes(1);
  });
});
