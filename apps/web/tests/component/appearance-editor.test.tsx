// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { designProperties } from '@gold/ui/design-system';
import { AppearanceEditor } from '@/features/appearance/appearance-editor';
import { updateAppearanceAction } from '@/app/settings/account/actions';
import { chooseOption, fieldValue } from '../support/select-field';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/app/settings/account/actions', () => ({ updateAppearanceAction: vi.fn() }));
afterEach(() => cleanup());
beforeEach(() => { vi.clearAllMocks(); });

const STYLES = ['Platform default', 'Minimal', 'Layered', 'Expressive'];
const preview = () => screen.getByTestId('appearance-preview');
const token = (name: string) => preview().style.getPropertyValue(name);
const resolved = (selection: Parameters<typeof designProperties>[0]) => designProperties(selection) as Record<string, string>;

it('offers every visual style as one radio group and renders only the main preview', async () => {
  const user = userEvent.setup(); const { container } = render(<AppearanceEditor saved={{}} />);
  const group = screen.getByRole('group', { name: 'Visual style' });
  expect(within(group).getAllByRole('radio').map(radio => radio.closest('label')!.textContent)).toEqual(STYLES);
  expect(within(group).getByRole('radio', { name: 'Platform default' })).toBeChecked();
  expect(container.querySelectorAll('[data-visual-scope]')).toHaveLength(1);
  expect(screen.queryByText('Surface preview')).toBeNull();
  for (const [index, name] of STYLES.entries()) {
    await user.click(within(group).getByRole('radio', { name }));
    expect(within(group).getByRole('radio', { name })).toBeChecked();
    expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(group.querySelectorAll('svg')).toHaveLength(1);
    expect(within(group).getAllByRole('radio')[index].closest('label')!.querySelector('svg')).not.toBeNull();
    if (index === 0) expect(preview()).not.toHaveAttribute('data-visual-preset');
    else expect(preview()).toHaveAttribute('data-visual-preset', name.toLowerCase());
  }
  expect(updateAppearanceAction).not.toHaveBeenCalled();
});

it('moves the selection with arrow keys and previews each style immediately', async () => {
  const user = userEvent.setup(); render(<AppearanceEditor saved={{ preset: 'layered' }} />);
  const layered = screen.getByRole('radio', { name: 'Layered' });
  await user.click(layered);
  expect(layered).toHaveFocus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Expressive' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Expressive' })).toHaveFocus();
  expect(preview()).toHaveAttribute('data-visual-preset', 'expressive');
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('radio', { name: 'Platform default' })).toBeChecked();
  expect(preview()).not.toHaveAttribute('data-visual-preset');
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('radio', { name: 'Expressive' })).toBeChecked();
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  expect(updateAppearanceAction).not.toHaveBeenCalled();
});

it('resolves the preview through the shared design tokens, including overrides', async () => {
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  expect(token('--visual-radius')).toBe('');
  await user.click(screen.getByRole('radio', { name: 'Expressive' }));
  for (const [name, value] of Object.entries(resolved({ preset: 'expressive' }))) expect(token(name)).toBe(value);
  await user.click(screen.getByRole('radio', { name: 'Minimal' }));
  expect(token('--visual-elevation')).toBe(resolved({ preset: 'minimal' })['--visual-elevation']);
  await chooseOption(screen.getByLabelText('Shape'), 'square');
  await chooseOption(screen.getByLabelText('Density'), 'compact');
  await chooseOption(screen.getByLabelText('Motion'), 'reduced');
  for (const [name, value] of Object.entries(resolved({ preset: 'minimal', shape: 'square', density: 'compact' }))) expect(token(name)).toBe(value);
  expect(preview()).toHaveAttribute('data-density', 'compact');
  expect(preview()).toHaveAttribute('data-motion', 'reduced');
  await chooseOption(screen.getByLabelText('Shape'), '');
  expect(token('--visual-radius')).toBe(resolved({ preset: 'minimal' })['--visual-radius']);
});

it('previews drafts without saving, discards, and keeps the preview scheme independent', async () => {
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  await user.click(screen.getByRole('radio', { name: 'Expressive' }));
  expect(preview()).toHaveAttribute('data-visual-preset', 'expressive');
  await chooseOption(screen.getByLabelText('Preview theme'), 'dark');
  expect(preview()).toHaveAttribute('data-appearance', 'dark');
  expect(fieldValue(screen.getByLabelText('Theme'))).toBe('system');
  expect(updateAppearanceAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(preview()).not.toHaveAttribute('data-visual-preset');
  expect(screen.getByRole('radio', { name: 'Platform default' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
});

it('uses a single application canvas behind the preview and keeps background drafts isolated', async () => {
  const user = userEvent.setup(); const { container } = render(<AppearanceEditor saved={{ background: 'grid' }} />);
  expect(preview().querySelectorAll('[data-slot=application-canvas-background]')).toHaveLength(1);
  expect(within(preview()).getByLabelText('Preview sidebar')).toBeVisible();
  expect(within(preview()).getByRole('table', { name: 'Collection preview' })).toBeVisible();
  expect(within(preview()).getByRole('region', { name: 'Directory' })).toBeVisible();
  expect(container.querySelectorAll('[data-decorative-background]')).toHaveLength(1);
  await chooseOption(screen.getByLabelText('Background'), 'gradient');
  expect(preview()).toHaveAttribute('data-background', 'gradient');
  expect(preview().querySelector('[data-decorative-background=gradient]')).not.toBeNull();
  expect(updateAppearanceAction).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(preview()).toHaveAttribute('data-background', 'grid');
  await chooseOption(screen.getByLabelText('Background'), 'none');
  expect(preview().querySelector('[data-slot=application-canvas-background]')).toBeNull();
});

it('keeps draft preview overlays in the draft scope outside its scroll frame', async () => {
  const user = userEvent.setup(); render(<AppearanceEditor saved={{ preset: 'minimal' }} />);
  await chooseOption(screen.getByLabelText('Preview theme'), 'dark');
  await user.click(screen.getByRole('button', { name: 'Open preview dialog' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.closest('[data-testid=appearance-preview]')).toBe(preview());
  expect(dialog.closest('[data-slot=preview-main]')).toBeNull();
  expect(dialog.closest('[data-appearance]')).toHaveAttribute('data-appearance', 'dark');
  await user.click(within(dialog).getAllByRole('button', { name: /^Close$/ })[0]);
});

it('never turns the preview theme into an unsaved theme change', async () => {
  const user = userEvent.setup(); render(<AppearanceEditor saved={{ appearance: 'light' }} />);
  await chooseOption(screen.getByLabelText('Preview theme'), 'dark');
  expect(preview()).toHaveAttribute('data-appearance', 'dark');
  expect(fieldValue(screen.getByLabelText('Theme'))).toBe('light');
  expect(screen.getByRole('status')).toHaveTextContent('Using saved appearance');
  expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
  await chooseOption(screen.getByLabelText('Theme'), 'dark');
  await chooseOption(screen.getByLabelText('Preview theme'), 'light');
  vi.mocked(updateAppearanceAction).mockResolvedValueOnce({ selection: { appearance: 'dark' } });
  await user.click(screen.getByRole('button', { name: 'Save appearance' }));
  await screen.findByText('Appearance saved.');
  expect(updateAppearanceAction).toHaveBeenCalledWith({ appearance: 'dark' }, false);
  expect(preview()).toHaveAttribute('data-appearance', 'light');
});

it('saves only on explicit action and resets through the domain action', async () => {
  vi.mocked(updateAppearanceAction).mockResolvedValueOnce({ selection: { appearance: 'light', density: 'compact', preset: 'layered' } }).mockResolvedValueOnce({ selection: {} });
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  await chooseOption(screen.getByLabelText('Theme'), 'light');
  await user.click(screen.getByRole('radio', { name: 'Layered' }));
  await chooseOption(screen.getByLabelText('Density'), 'compact');
  await user.click(screen.getByRole('button', { name: 'Save appearance' }));
  await screen.findByText('Appearance saved.');
  expect(refresh).toHaveBeenCalled();
  expect(updateAppearanceAction).toHaveBeenCalledWith({ appearance: 'light', density: 'compact', preset: 'layered' }, false);
  expect(screen.getByRole('radio', { name: 'Layered' })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
  await screen.findByText('Defaults restored.');
  expect(fieldValue(screen.getByLabelText('Density'))).toBe('');
  expect(screen.getByRole('radio', { name: 'Platform default' })).toBeChecked();
  expect(updateAppearanceAction).toHaveBeenLastCalledWith({ appearance: 'light', density: 'compact', preset: 'layered' }, true);
});

it('locks the choices while saving', async () => {
  let finish!: (value: Awaited<ReturnType<typeof updateAppearanceAction>>) => void;
  vi.mocked(updateAppearanceAction).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  await user.click(screen.getByRole('radio', { name: 'Minimal' }));
  await user.click(screen.getByRole('button', { name: 'Save appearance' }));
  await waitFor(() => expect(screen.getByRole('radio', { name: 'Expressive' })).toBeDisabled());
  finish({ selection: { preset: 'minimal' } });
  await screen.findByText('Appearance saved.');
  expect(screen.getByRole('radio', { name: 'Expressive' })).toBeEnabled();
});

it('retains rejected drafts and exposes an actionable error instead of a saved state', async () => {
  vi.mocked(updateAppearanceAction).mockResolvedValue({ error: 'Save refused. Try again.' });
  const user = userEvent.setup(); render(<AppearanceEditor saved={{}} />);
  await chooseOption(screen.getByLabelText('Shape'), 'square');
  await user.click(screen.getByRole('button', { name: 'Save appearance' }));
  await screen.findByText('Save refused. Try again.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save appearance' })).toBeEnabled());
  expect(fieldValue(screen.getByLabelText('Shape'))).toBe('square');
  expect(refresh).not.toHaveBeenCalled();
});
