// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagePanel, WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import { EditorLayout, PANEL_BOUNDS } from '@/features/studio/editor-layout';

/** Studio's one workbench layout: resizable, collapsible panels, a maximized canvas and stable editing state. */

function Workbench({ id = 'test' }: { id?: string }) {
  return (
    <WorkspaceRailProvider>
      <EditorLayout id={id} structure={<input aria-label="Structure field" />} inspector={<input aria-label="Inspector field" />}>
        <p>Canvas content</p>
      </EditorLayout>
      <PagePanel />
    </WorkspaceRailProvider>
  );
}

const separator = (name: string) => screen.getByRole('separator', { name });
const pane = (name: string) => document.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;

beforeEach(() => {
  window.localStorage.clear();
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('a wide workbench', () => {
  it('resizes a panel from the keyboard within its minimum and maximum', () => {
    render(<Workbench />);
    const resize = separator('Resize Structure');
    expect(resize.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.initial));
    fireEvent.keyDown(resize, { key: 'ArrowRight' });
    expect(resize.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.initial + 16));
    fireEvent.keyDown(resize, { key: 'ArrowRight', shiftKey: true });
    expect(resize.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.initial + 16 + 64));
    fireEvent.keyDown(resize, { key: 'End' });
    expect(resize.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.max));
    fireEvent.keyDown(resize, { key: 'ArrowRight' });
    expect(resize.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.max));
    fireEvent.keyDown(resize, { key: 'Home' });
    expect(resize.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.min));
    fireEvent.keyDown(resize, { key: 'ArrowLeft' });
    expect(resize.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.min));
    // The inspector grows towards the canvas, so its arrows run the other way.
    const inspector = separator('Resize Inspector');
    fireEvent.keyDown(inspector, { key: 'ArrowLeft' });
    expect(inspector.getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.inspector.initial + 16));
  });

  it('collapses and restores each panel on its own, keeping what is in it', async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await user.type(screen.getByLabelText('Structure field'), 'kept');
    await user.click(screen.getByRole('button', { name: 'Hide Structure' }));
    expect(pane('Structure').hidden).toBe(true);
    expect(pane('Inspector').hidden).toBe(false);
    expect(screen.queryByRole('separator', { name: 'Resize Structure' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show Structure' }));
    expect(pane('Structure').hidden).toBe(false);
    expect((screen.getByLabelText('Structure field') as HTMLInputElement).value).toBe('kept');
    // Enter on a separator collapses its panel.
    fireEvent.keyDown(separator('Resize Inspector'), { key: 'Enter' });
    expect(pane('Inspector').hidden).toBe(true);
  });

  it('maximizes the canvas and restores the panels as they were', async () => {
    const user = userEvent.setup();
    render(<Workbench />);
    await user.click(screen.getByRole('button', { name: 'Hide Inspector' }));
    await user.click(screen.getByRole('button', { name: 'Maximize canvas' }));
    expect(pane('Structure').hidden).toBe(true);
    expect(pane('Inspector').hidden).toBe(true);
    expect(screen.getByText('Canvas content')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore panels' }));
    expect(pane('Structure').hidden).toBe(false);
    expect(pane('Inspector').hidden).toBe(true);
  });

  it('remembers widths and collapsed panels per editor', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Workbench id="website" />);
    fireEvent.keyDown(separator('Resize Structure'), { key: 'ArrowRight' });
    await user.click(screen.getByRole('button', { name: 'Hide Inspector' }));
    unmount();
    render(<Workbench id="website" />);
    expect(separator('Resize Structure').getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.initial + 16));
    expect(pane('Inspector').hidden).toBe(true);
    cleanup();
    render(<Workbench id="form" />);
    expect(separator('Resize Structure').getAttribute('aria-valuenow')).toBe(String(PANEL_BOUNDS.structure.initial));
  });
});

describe('a compact workbench', () => {
  it('opens the panels as drawers instead of columns', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 800, top: 0, left: 0, right: 600, bottom: 800, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    const user = userEvent.setup();
    const { container } = render(<Workbench />);
    expect(container.querySelector('[data-editor-layout]')?.getAttribute('data-editor-layout')).toBe('compact');
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Maximize canvas' })).toBeNull();
    expect(screen.queryByLabelText('Structure field')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show Structure' }));
    expect(screen.getByLabelText('Structure field')).toBeTruthy();
  });
});
