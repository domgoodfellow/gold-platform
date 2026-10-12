// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearanceEditor } from '@/features/appearance/appearance-editor';
import { updateAppearanceAction } from '@/app/settings/account/actions';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/app/settings/account/actions', () => ({ updateAppearanceAction: vi.fn() }));
afterEach(() => cleanup());
beforeEach(() => { vi.clearAllMocks(); });

it('previews drafts without saving, discards, and keeps the preview scheme independent', async () => {
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  await user.click(screen.getByRole('button', { name: 'Expressive' }));
  expect(screen.getByTestId('appearance-preview')).toHaveAttribute('data-visual-preset', 'expressive');
  await user.selectOptions(screen.getByLabelText('Preview theme'), 'dark');
  expect(screen.getByLabelText('Theme')).toHaveValue('system');
  expect(updateAppearanceAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByTestId('appearance-preview')).not.toHaveAttribute('data-visual-preset');
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
});
it('saves only on explicit action and resets through the domain action', async () => {
  vi.mocked(updateAppearanceAction).mockResolvedValueOnce({ selection: { appearance: 'light', density: 'compact' } }).mockResolvedValueOnce({ selection: {} });
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  await user.selectOptions(screen.getByLabelText('Theme'), 'light');
  await user.selectOptions(screen.getByLabelText('Density'), 'compact');
  await user.click(screen.getByRole('button', { name: 'Save appearance' }));
  await screen.findByText('Appearance saved.');
  expect(refresh).toHaveBeenCalled();
  expect(updateAppearanceAction).toHaveBeenCalledWith({ appearance: 'light', density: 'compact' }, false);
  await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
  await screen.findByText('Defaults restored.');
  expect(screen.getByLabelText('Density')).toHaveValue('');
  expect(updateAppearanceAction).toHaveBeenLastCalledWith({ appearance: 'light', density: 'compact' }, true);
});
it('retains rejected drafts and exposes an actionable error instead of a saved state', async () => {
  vi.mocked(updateAppearanceAction).mockResolvedValue({ error: 'Save refused. Try again.' });
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  await user.selectOptions(screen.getByLabelText('Shape'), 'square');
  await user.click(screen.getByRole('button', { name: 'Save appearance' }));
  await screen.findByText('Save refused. Try again.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save appearance' })).toBeEnabled());
  expect(screen.getByLabelText('Shape')).toHaveValue('square');
  expect(refresh).not.toHaveBeenCalled();
});
