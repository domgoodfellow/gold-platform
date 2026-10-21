// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagePanel, WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import {
  PageDrawer,
  PageDrawerClose,
  PageDrawerContent,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
  usePageDrawerUnsavedChanges,
} from '@/components/panels/page-drawer';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';

/** An editing form that opts in to the unsaved-change contract, the way a real drawer form does. */
function GuardedForm({ onSaved }: { onSaved?: () => void }) {
  const { ref, dirty, onChange } = useFormDirty();
  usePageDrawerUnsavedChanges(dirty);
  return (
    <form ref={ref} onChange={onChange} onSubmit={(event) => { event.preventDefault(); onSaved?.(); }} id="guarded-form">
      <label htmlFor="name">Name</label>
      <input id="name" name="name" defaultValue="Original" />
    </form>
  );
}

function GuardedDrawer() {
  const [open, setOpen] = useState(false);
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger>Open guarded</PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Guarded</PageDrawerTitle></PageDrawerHeader>
        <GuardedForm onSaved={() => setOpen(false)} />
        <PageDrawerFooter>
          <button type="submit" form="guarded-form">Save</button>
          <PageDrawerClose>Cancel</PageDrawerClose>
        </PageDrawerFooter>
      </PageDrawerContent>
    </PageDrawer>
  );
}

/** A drawer that never opts in — inspection panels and every not-yet-migrated form. */
function PlainDrawer() {
  return (
    <PageDrawer>
      <PageDrawerTrigger>Open plain</PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Plain</PageDrawerTitle></PageDrawerHeader>
        <label htmlFor="note">Note</label>
        <input id="note" name="note" />
      </PageDrawerContent>
    </PageDrawer>
  );
}

/** A guarded drawer with a popover inside it and a second drawer that opens on top of it. */
function LayeredDrawer() {
  return (
    <PageDrawer>
      <PageDrawerTrigger>Open layered</PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Layered</PageDrawerTitle></PageDrawerHeader>
        <GuardedForm />
        <Popover>
          <PopoverTrigger>Pick</PopoverTrigger>
          <PopoverContent>Popover body</PopoverContent>
        </Popover>
        <PageDrawer>
          <PageDrawerTrigger>Open inner</PageDrawerTrigger>
          <PageDrawerContent>
            <PageDrawerHeader><PageDrawerTitle>Inner</PageDrawerTitle></PageDrawerHeader>
            <p>Read-only detail</p>
          </PageDrawerContent>
        </PageDrawer>
      </PageDrawerContent>
    </PageDrawer>
  );
}

function Harness({ children }: { children: React.ReactNode }) {
  return <WorkspaceRailProvider>{children}<PagePanel /></WorkspaceRailProvider>;
}

const drawer = (name: string) => screen.queryByRole('dialog', { name });
const confirmation = () => screen.queryByRole('dialog', { name: 'Discard unsaved changes?' });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

async function openGuarded() {
  const user = userEvent.setup();
  render(<Harness><GuardedDrawer /></Harness>);
  await user.click(screen.getByRole('button', { name: 'Open guarded' }));
  return user;
}
async function edit(user: ReturnType<typeof userEvent.setup>) {
  const input = screen.getByLabelText('Name');
  await user.clear(input);
  await user.type(input, 'Changed');
  await settle();
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('PageDrawer unsaved-change contract', () => {
  it('closes an unchanged guarded drawer at once from the close button and Escape', async () => {
    const user = await openGuarded();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(drawer('Guarded')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open guarded' }));
    await user.keyboard('{Escape}');
    expect(drawer('Guarded')).toBeNull();
    expect(confirmation()).toBeNull();
  });

  it.each([
    ['the close button', (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Escape}')],
    ['Cancel', (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Cancel' }))],
  ])('asks before discarding changes from %s, and Keep editing keeps the input', async (_label, close) => {
    const user = await openGuarded();
    await edit(user);
    await close(user);
    expect(confirmation()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(confirmation()).toBeNull());
    expect(drawer('Guarded')).not.toBeNull();
    expect(screen.getByLabelText('Name')).toHaveValue('Changed');
    // Focus goes back to what had it inside the drawer, never to the page body.
    await waitFor(() => expect(drawer('Guarded')!.contains(document.activeElement)).toBe(true));
  });

  it('Escape inside the confirmation closes only the confirmation', async () => {
    const user = await openGuarded();
    await edit(user);
    await user.keyboard('{Escape}');
    expect(confirmation()).not.toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(confirmation()).toBeNull());
    expect(drawer('Guarded')).not.toBeNull();
    expect(screen.getByLabelText('Name')).toHaveValue('Changed');
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
  });

  it('Discard closes the drawer and returns focus to what opened it', async () => {
    const user = await openGuarded();
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(drawer('Guarded')).toBeNull());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open guarded' })).toHaveFocus());
    expect(document.body.style.pointerEvents).not.toBe('none');
  });

  it('reopens fresh after a discard: unchanged, and closing no longer asks', async () => {
    const user = await openGuarded();
    await edit(user);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(drawer('Guarded')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Open guarded' }));
    expect(screen.getByLabelText('Name')).toHaveValue('Original');
    await user.keyboard('{Escape}');
    expect(confirmation()).toBeNull();
    expect(drawer('Guarded')).toBeNull();
  });

  it('a successful save closed by the owner is never asked about', async () => {
    const user = await openGuarded();
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(confirmation()).toBeNull();
    expect(drawer('Guarded')).toBeNull();
  });

  it('keeps Escape working when a submit has left focus on the page body', async () => {
    const user = await openGuarded();
    await edit(user);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(confirmation()).not.toBeNull();
  });

  describe('the body-focus Escape fallback stays scoped', () => {
    async function openLayered() {
      const user = userEvent.setup();
      render(<Harness><LayeredDrawer /></Harness>);
      await user.click(screen.getByRole('button', { name: 'Open layered' }));
      await edit(user);
      return user;
    }
    const blurToBody = () => act(() => (document.activeElement as HTMLElement | null)?.blur());

    it('leaves an open confirmation to its own Escape: it closes, the drawer and its changes stay', async () => {
      const user = await openLayered();
      await user.keyboard('{Escape}');
      expect(confirmation()).not.toBeNull();
      // The shared Dialog dismisses itself on any Escape; the drawer must neither close nor discard.
      fireEvent.keyDown(document.body, { key: 'Escape' });
      await waitFor(() => expect(confirmation()).toBeNull());
      expect(drawer('Layered')).not.toBeNull();
      expect(screen.getByLabelText('Name')).toHaveValue('Changed');
    });

    it('lets a popover inside the drawer close itself without touching the drawer', async () => {
      const user = await openLayered();
      await user.click(screen.getByRole('button', { name: 'Pick' }));
      expect(screen.getByText('Popover body')).toBeVisible();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('Popover body')).toBeNull());
      expect(confirmation()).toBeNull();
      expect(drawer('Layered')).not.toBeNull();
    });

    it('never reaches a guarded drawer that is beneath another drawer', async () => {
      const user = await openLayered();
      await user.click(screen.getByRole('button', { name: 'Open inner' }));
      expect(drawer('Inner')).not.toBeNull();
      blurToBody();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(confirmation()).toBeNull();
      expect(drawer('Inner')).not.toBeNull();
      // Closing the top drawer brings the guarded one back, still holding its changes.
      await user.click(within(drawer('Inner')!).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(drawer('Layered')).not.toBeNull());
      expect(screen.getByLabelText('Name')).toHaveValue('Changed');
    });

    it('ignores a key that something else already handled', async () => {
      await openLayered();
      blurToBody();
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      event.preventDefault();
      act(() => { document.body.dispatchEvent(event); });
      expect(confirmation()).toBeNull();
      expect(drawer('Layered')).not.toBeNull();
    });
  });

  it('leaves a drawer that never opts in exactly as before', async () => {
    const user = userEvent.setup();
    render(<Harness><PlainDrawer /></Harness>);
    await user.click(screen.getByRole('button', { name: 'Open plain' }));
    await user.type(screen.getByLabelText('Note'), 'typed');
    await user.keyboard('{Escape}');
    expect(confirmation()).toBeNull();
    expect(drawer('Plain')).toBeNull();
    // A body Escape does not reach an unguarded drawer: its behavior is unchanged.
    await user.click(screen.getByRole('button', { name: 'Open plain' }));
    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(drawer('Plain')).not.toBeNull();
  });
});
