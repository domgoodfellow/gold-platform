// @vitest-environment jsdom
import { useEffect, useMemo } from 'react';
import { TooltipProvider } from '@gold/ui/components/tooltip';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentTrigger,
  WorkspaceRailProvider,
  WorkspaceRightRail,
  useAgentContent,
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

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout engine and no `matchMedia`; the rail's own breakpoint hook only needs
  // the call to exist, never fire a real change here.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function AgentProbe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <div data-testid="agent-content">Ask about this business…</div>;
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
    // Closed means hidden (`aside` gets `hidden` styling), not removed — `AgentPanel` keeps the
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
});
