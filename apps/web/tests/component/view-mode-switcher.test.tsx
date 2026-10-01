// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ViewModeSwitcher, type CollectionPresentation } from '@/components/controls/view-mode-switcher';
import { runAxe } from '@/tests/support/axe';

/**
 * `ViewModeSwitcher` by rendered behaviour: the static-markup check in
 * `tests/component/ui-components.test.ts` already proved the string shape (one `role="group"`,
 * `aria-pressed` on each button); this proves keyboard operability and that pressing a button
 * really does flip which one is pressed, which a string comparison cannot show.
 */

afterEach(cleanup);

function Controlled({ initial }: { initial: CollectionPresentation }) {
  const [value, setValue] = useState<CollectionPresentation>(initial);
  return <ViewModeSwitcher supported={['table', 'list', 'grid']} value={value} onChange={setValue} label="Layout" />;
}

describe('ViewModeSwitcher', () => {
  it('is reachable by Tab, in source order, as ordinary buttons rather than a roving radio group', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="table" />);
    const [table, list, grid] = screen.getAllByRole('button');

    await user.tab();
    expect(table).toHaveFocus();
    await user.tab();
    expect(list).toHaveFocus();
    await user.tab();
    expect(grid).toHaveFocus();
  });

  it('activates on Enter and on Space, and flips aria-pressed on the button that was activated', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="table" />);

    const list = screen.getByRole('button', { name: 'List' });
    const grid = screen.getByRole('button', { name: 'Grid' });
    list.focus();
    await user.keyboard('{Enter}');
    expect(list).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'false');

    grid.focus();
    await user.keyboard(' ');
    expect(grid).toHaveAttribute('aria-pressed', 'true');
    expect(list).toHaveAttribute('aria-pressed', 'false');
  });

  it('activates on click the same way, and never changes more than one button at a time', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="table" />);

    await user.click(screen.getByRole('button', { name: 'Grid' }));
    const pressed = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true');
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toHaveAccessibleName('Grid');
  });

  it('has no axe violation', async () => {
    const { container } = render(<Controlled initial="list" />);
    expect(await runAxe(container)).toEqual([]);
  });
});
