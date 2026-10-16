// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@gold/ui/components/tabs';
import { tabListStyles, tabListVariants } from '@gold/ui/components/tab-styles';
import { ViewNav } from '@/components/navigation/view-nav';
import { NavigationList } from '@/components/navigation/navigation-list';
import { ViewModeSwitcher } from '@/components/controls/view-mode-switcher';

vi.mock('next/link', () => ({ default: ({ href, scroll, children, ...props }: Record<string, unknown>) => <a href={String(href)} data-scroll={String(scroll)} {...props}>{children as never}</a> }));
afterEach(cleanup);

it('keeps structural wrapping independent from segmented and line presentation', () => {
  expect(tabListStyles()).toContain('flex-wrap');
  expect(tabListStyles()).not.toMatch(/overflow|border-b|sm:w-fit/);
  expect(tabListVariants.line).toContain('border-b');
  expect(tabListVariants.line).not.toContain('bg-');
});

it('supports both URL contracts, explicit current state, scroll and line styling', () => {
  const items = [{ key: 'one', label: 'One', href: '/one', current: true }, { key: 'two', label: 'Two', href: '/two' }];
  const { rerender } = render(<ViewNav label="Views" items={items} scroll={false} />);
  expect(screen.getByRole('navigation')).toHaveAttribute('data-variant', 'segmented');
  expect(screen.getByRole('link', { name: 'One' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'One' })).toHaveAttribute('data-scroll', 'false');
  expect(screen.queryByRole('tab')).toBeNull();
  rerender(<ViewNav label="Views" views={items} current="two" variant="line" />);
  expect(screen.getByRole('navigation')).toHaveAttribute('data-variant', 'line');
  expect(screen.getByRole('link', { name: 'Two' })).toHaveAttribute('href', '/two');
  expect(screen.getByRole('link', { name: 'Two' })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('link', { name: 'One' })).not.toHaveAttribute('aria-current');
});

it('retains Radix arrow, Home and End navigation and panel relationships', async () => {
  const user = userEvent.setup();
  render(<Tabs defaultValue="one"><TabsList aria-label="Content"><TabsTrigger value="one">One</TabsTrigger><TabsTrigger value="two">Two</TabsTrigger></TabsList><TabsContent value="one">First panel</TabsContent><TabsContent value="two">Second panel</TabsContent></Tabs>);
  const first = screen.getByRole('tab', { name: 'One' });
  const second = screen.getByRole('tab', { name: 'Two' });
  expect(screen.getByRole('tablist')).toHaveAttribute('data-variant', 'segmented');
  first.focus();
  await user.keyboard('{ArrowRight}');
  expect(second).toHaveFocus();
  expect(second).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel')).toHaveAttribute('id', second.getAttribute('aria-controls'));
  await user.keyboard('{Home}');
  expect(first).toHaveFocus();
  await user.keyboard('{End}');
  expect(second).toHaveFocus();
});

it('renders full-row links inside real list items, with optional content and current state', () => {
  render(<NavigationList label="Destinations" density="compact" current="files" items={[{ key: 'files', href: '/files', title: 'Files', description: 'Shared content', metadata: 'Available', icon: <svg />, chevron: true }, { key: 'media', href: '/media', title: 'Media' }]} />);
  const nav = screen.getByRole('navigation', { name: 'Destinations' });
  expect(nav).toHaveAttribute('data-density', 'compact');
  const rows = within(nav).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  const link = within(rows[0]).getByRole('link');
  expect(link).toHaveAttribute('aria-current', 'page');
  expect(link).toHaveAttribute('href', '/files');
  expect(within(link).getByText('Shared content')).toBeInTheDocument();
  expect(within(link).getByText('Available')).toBeInTheDocument();
  expect(link).not.toHaveAttribute('role');
  expect(nav.innerHTML).not.toContain('divide-y');
});

it('keeps collection representation a pressed button group using the same tokens', async () => {
  const onChange = vi.fn();
  render(<ViewModeSwitcher supported={['list', 'grid']} value="list" onChange={onChange} />);
  expect(screen.getByRole('group')).toHaveAttribute('data-variant', 'segmented');
  expect(screen.getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Grid' }));
  expect(onChange).toHaveBeenCalledWith('grid');
});
