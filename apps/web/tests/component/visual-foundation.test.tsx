// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button } from '@/components/controls/button';
import { SelectableCard } from '@/components/controls/selectable-card';
import { VisualScope } from '@gold/ui/components/visual-scope';
import { Popover, PopoverTrigger, PopoverContent } from '@gold/ui/components/popover';
import { FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { runAxe } from '@/tests/support/axe';
import { DecorativeBackground } from '@/components/display/background-treatment';

afterEach(cleanup);
describe('decorative background treatments', () => {
  const region = (selection: Parameters<typeof VisualScope>[0]['selection']) => render(
    <VisualScope selection={selection} data-testid="scope"><div className="relative isolate"><DecorativeBackground /><button type="button">Add contact</button></div></VisualScope>,
  );
  it('draws nothing by default and never adds a preset-driven background', () => {
    const { container } = region({ preset: 'expressive' });
    expect(container.querySelector('[data-decorative-background]')).toBeNull();
    expect(screen.getByTestId('scope')).not.toHaveAttribute('data-background');
  });
  for (const background of ['gradient', 'grid'] as const) {
    it(`draws the ${background} as hidden, non-interactive decoration behind the content`, () => {
      const { container } = region({ background });
      const layer = container.querySelector(`[data-decorative-background=${background}]`)!;
      expect(layer).toHaveAttribute('aria-hidden', 'true');
      expect(layer.className).toContain('pointer-events-none');
      expect(layer.className).toContain('-z-10');
      expect(screen.getByTestId('scope')).toHaveAttribute('data-background', background);
      expect(screen.getByRole('button', { name: 'Add contact' })).toBeVisible();
    });
  }
  it('falls back to the static gradient when WebGL is unavailable, without loading the 3D scene', () => {
    // jsdom has no WebGL, which is exactly the fallback case.
    const { container } = region({ background: 'ambient3d' });
    const layer = container.querySelector('[data-decorative-background]')!;
    expect(layer).toHaveAttribute('data-decorative-background', 'ambient3d-fallback');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    expect(layer.querySelector('canvas')).toBeNull();
  });
  it('lets a preview override the saved treatment', () => {
    const { container } = render(<VisualScope selection={{}}><DecorativeBackground treatment="grid" /></VisualScope>);
    expect(container.querySelector('[data-decorative-background=grid]')).not.toBeNull();
  });
});
describe('visual foundation behavior', () => {
  it('loading blocks activation and preserves the accessible name', () => {
    const click = vi.fn();
    render(<Button loading onClick={click}>Saving settings</Button>);
    const button = screen.getByRole('button', { name: 'Saving settings' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(click).not.toHaveBeenCalled();
  });
  it('selectable cards expose selection and leave decisions to callers', () => {
    const click = vi.fn();
    const { rerender } = render(<SelectableCard selected={false} onClick={click}>Services</SelectableCard>);
    fireEvent.click(screen.getByRole('button', { name: 'Services' }));
    expect(click).toHaveBeenCalledOnce();
    rerender(<SelectableCard selected>Services</SelectableCard>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
  it('portals stay within their own scheme and preset boundary', async () => {
    render(<VisualScope selection={{ preset: 'expressive', appearance: 'dark' }} data-testid="scope"><Popover defaultOpen><PopoverTrigger>Filter</PopoverTrigger><PopoverContent>Scoped filter</PopoverContent></Popover></VisualScope>);
    const content = await screen.findByText('Scoped filter');
    expect(screen.getByTestId('scope')).toContainElement(content);
    expect(content.closest('[data-appearance]')).toHaveAttribute('data-appearance', 'dark');
  });
  it('filled fields retain accessible error relationships', async () => {
    const { container } = render(<VisualScope selection={{ preset: 'minimal', appearance: 'light' }}><FormField id="contact" label="Contact" error="Enter an address">{(props) => <TextInput {...props} variant="filled" />}</FormField></VisualScope>);
    const input = screen.getByRole('textbox', { name: 'Contact' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter an address');
    expect(await runAxe(container)).toEqual([]);
  });
});
