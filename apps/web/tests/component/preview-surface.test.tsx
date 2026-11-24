// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewSurface } from '@/components/display/preview-surface';

/**
 * The large preview for visual experiences: controls outside the content, reference widths, page
 * selection, Escape to close with focus back on the trigger. (jsdom does not load the isolated
 * frame's document; what it draws is proven in the browser.)
 */
beforeEach(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const frameTitle = () => screen.getByTitle(/·/).getAttribute('title');

function Collection({ onUse = vi.fn() }: { onUse?: () => void }) {
  return (
    <div>
      <input aria-label="Search templates" defaultValue="service" />
      <PreviewSurface
        title="Local service business"
        trigger={<button type="button">Preview Local service business</button>}
        pages={[{ key: 'home', label: 'Home', content: <p>Home page</p> }, { key: 'services', label: 'Services', content: <p>Services page</p> }]}
        actions={<button type="button" onClick={onUse}>Use template</button>}
      />
    </div>
  );
}

describe('the preview surface', () => {
  it('opens full screen with its controls outside the content', async () => {
    const user = userEvent.setup();
    render(<Collection />);
    await user.click(screen.getByRole('button', { name: 'Preview Local service business' }));
    const dialog = screen.getByRole('dialog', { name: 'Local service business' });
    expect(dialog.hasAttribute('data-preview-surface')).toBe(true);
    expect(screen.getByRole('group', { name: 'Preview width' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeTruthy();
    // The rendered experience is an isolated frame; the controls are not inside it.
    expect(dialog.querySelector('iframe')).toBeTruthy();
    expect(dialog.querySelector('iframe')!.closest('header')).toBeNull();
    expect(frameTitle()).toBe('Local service business · Home · Desktop');
  });

  it('selects a page and a reference width without touching what it previews', async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<Collection onUse={onUse} />);
    await user.click(screen.getByRole('button', { name: 'Preview Local service business' }));
    await user.click(screen.getByRole('button', { name: 'Services' }));
    expect(screen.getByRole('button', { name: 'Services' }).getAttribute('aria-current')).toBe('page');
    expect(frameTitle()).toBe('Local service business · Services · Desktop');
    await user.click(screen.getByRole('button', { name: 'Mobile' }));
    expect(screen.getByRole('button', { name: 'Mobile' }).getAttribute('aria-pressed')).toBe('true');
    expect(frameTitle()).toBe('Local service business · Services · Mobile');
    expect(screen.getByTitle(/Mobile/).style.width).toBe('390px');
    await user.click(screen.getByRole('button', { name: 'Tablet' }));
    expect(screen.getByTitle(/Tablet/).style.width).toBe('768px');
    expect(onUse).not.toHaveBeenCalled();
  });

  it('closes with Escape, returns focus to its trigger and leaves the collection as it was', async () => {
    const user = userEvent.setup();
    render(<Collection />);
    const trigger = screen.getByRole('button', { name: 'Preview Local service business' });
    await user.click(trigger);
    await user.click(screen.getByRole('button', { name: 'Services' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect((screen.getByLabelText('Search templates') as HTMLInputElement).value).toBe('service');
    // Opening again starts from the first page.
    await user.click(trigger);
    expect(frameTitle()).toBe('Local service business · Home · Desktop');
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
