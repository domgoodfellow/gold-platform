// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Toaster } from '@gold/ui/components/sonner';

/**
 * The shared toast surface (Work Order 4, Part F), by rendered behaviour: every toast has a close
 * button with a name, success and info toasts close on their own, and an error toast stays until the
 * person closes it, without any caller asking for that.
 */

// jsdom has no matchMedia; Sonner reads it for the colour scheme.
window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as typeof window.matchMedia;

afterEach(() => {
  act(() => toast.dismiss());
  cleanup();
  vi.useRealTimers();
});

describe('Toaster', () => {
  it('gives every toast a named close button', async () => {
    render(<Toaster />);
    act(() => { toast.success('Location added'); });
    expect(await screen.findByText('Location added')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close notification' })).toBeInTheDocument();
  });

  it('closes a success toast on its own, and keeps an error toast until it is closed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Toaster />);
    act(() => { toast.success('Saved'); toast.error('That already exists.'); });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByText('That already exists.')).toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('That already exists.')).toBeInTheDocument();

    const close = screen.getAllByRole('button', { name: 'Close notification' })[0];
    await act(async () => { close.click(); await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByText('That already exists.')).not.toBeInTheDocument();
  });
});
