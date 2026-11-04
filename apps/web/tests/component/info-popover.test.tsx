// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { InfoPopover } from '@/components/controls/info-popover';

afterEach(cleanup);

describe('InfoPopover', () => {
  it('names its trigger, exposes expanded state and opens on click', async () => {
    const user = userEvent.setup();
    render(<InfoPopover label="About resolution performance">Duration counts from creation.</InfoPopover>);
    const trigger = screen.getByRole('button', { name: 'About resolution performance' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Duration counts from creation.')).toBeNull();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Duration counts from creation.')).toBeInTheDocument();
  });

  it('opens from the keyboard, and Escape closes it and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<InfoPopover label="About delivery states">Sent means the provider accepted it.</InfoPopover>);
    const trigger = screen.getByRole('button', { name: 'About delivery states' });
    await user.tab();
    expect(trigger).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByText('Sent means the provider accepted it.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Sent means the provider accepted it.')).toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('keeps a 44px touch target on a phone and is compact from the small breakpoint up', () => {
    render(<InfoPopover label="About this figure">Detail.</InfoPopover>);
    const trigger = screen.getByRole('button', { name: 'About this figure' });
    expect(trigger.className).toContain('size-11');
    expect(trigger.className).toContain('sm:size-7');
  });
});
