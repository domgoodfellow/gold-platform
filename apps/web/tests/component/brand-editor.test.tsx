// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrandEditor } from '@/features/branding/brand-editor';
import { DEFAULT_BRAND } from '@/lib/domain/branding/brand';

vi.mock('@/app/organizations/[organizationId]/settings/actions', () => ({
  updateBrandAction: vi.fn(async () => ({ error: null, saved: true })),
  uploadLogoAction: vi.fn(async () => ({ error: null })),
  removeLogoAction: vi.fn(async () => ({ error: null })),
}));

afterEach(cleanup);

const mount = (overrides: Partial<typeof DEFAULT_BRAND> = {}, readOnly = false) =>
  render(
    <BrandEditor
      organizationId="org"
      brand={{ ...DEFAULT_BRAND, ...overrides }}
      logoUrl={null}
      name="Acme Plumbing"
      readOnly={readOnly}
    />,
  );

const previewAccent = () => screen.getByTestId('brand-preview').style.getPropertyValue('--accent');

describe('BrandEditor', () => {
  it('always renders a preview, on the platform default when nothing is set', () => {
    mount();
    expect(previewAccent()).toBe('var(--foreground)');
  });

  it('updates the preview from a draft before anything is saved, and enables Save', async () => {
    mount();
    const save = screen.getByRole('button', { name: 'Save appearance' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Teal' }));
    expect(previewAccent()).toBe('#0f766e');
    expect(save).toBeEnabled();
  });

  it('rejects a malformed colour, blocks saving, and keeps the preview on the saved value', async () => {
    mount({ accent: '#2563eb' });
    const hex = screen.getByLabelText('Hex value');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#12');
    expect(screen.getByText(/That is not a colour/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
    expect(previewAccent()).toBe('#2563eb');
  });

  it('applies the chosen fonts to the preview scope', async () => {
    mount();
    await userEvent.click(screen.getAllByRole('radio', { name: /Traditional/ })[0]!);
    expect(screen.getByTestId('brand-preview').style.getPropertyValue('--font-heading')).toContain('Georgia');
  });

  it('resets the draft to the platform default and discards edits', async () => {
    mount({ accent: '#2563eb', headingFont: 'serif' });
    await userEvent.click(screen.getByRole('button', { name: 'Use platform default' }));
    expect(previewAccent()).toBe('var(--foreground)');
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(previewAccent()).toBe('#2563eb');
  });

  it('is read-only without the capability', () => {
    mount({}, true);
    expect(screen.queryByRole('button', { name: 'Save appearance' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Blue' })).toBeDisabled();
  });
});
