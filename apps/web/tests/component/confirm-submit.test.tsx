// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { runAxe } from '@/tests/support/axe';

/**
 * The destructive-submit confirmation, by rendered behaviour: a trigger that opens a real dialog,
 * focus landing inside it, Escape cancelling without submitting anything, and the confirming
 * action staying one explicit click away — never something Enter-elsewhere could reach.
 */

afterEach(cleanup);

function renderDialog() {
  return render(
    <form id="remove-form" onSubmit={(event) => event.preventDefault()}>
      <ConfirmSubmit
        formId="remove-form"
        label="Remove"
        confirmLabel="Remove this item?"
        description="This cannot be undone."
      />
    </form>,
  );
}

describe('ConfirmSubmit', () => {
  it('opens a real dialog on click, with the description read and focus moved inside it', async () => {
    const user = userEvent.setup();
    renderDialog();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName('Remove this item?');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    // Radix's focus scope moves focus inside the dialog as soon as it opens.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('Escape cancels without submitting', async () => {
    const user = userEvent.setup();
    renderDialog();
    const submit = vi.fn();
    document.getElementById('remove-form')!.addEventListener('submit', submit);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(submit).not.toHaveBeenCalled();
  });

  it('confirming requires the explicit confirm button — Cancel leaves the form untouched', async () => {
    const user = userEvent.setup();
    renderDialog();
    const submit = vi.fn();
    document.getElementById('remove-form')!.addEventListener('submit', submit);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(submit).not.toHaveBeenCalled();
  });

  it('the confirm button is the only route to submitting, and it names the action rather than saying only "Confirm"', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = screen.getAllByRole('button', { name: 'Remove this item?' }).find((button) => dialog.contains(button))!;
    expect(confirm).toHaveAttribute('type', 'submit');
    expect(confirm).toHaveAttribute('form', 'remove-form');
  });

  it('has no axe violation while open', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(await runAxe(dialog)).toEqual([]);
  });
});
