// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPage } from '@/components/layout/app-page';

const location = vi.hoisted(() => ({ path: '/organizations/org/work/configuration', query: 'setupStep=operations' }));
vi.mock('next/navigation', () => ({ usePathname: () => location.path, useSearchParams: () => new URLSearchParams(location.query) }));
afterEach(cleanup);

describe('configuration continuity', () => {
  it('returns from the current organization editor to its originating setup step', () => {
    location.path = '/organizations/org/work/configuration'; location.query = 'type=t1&tab=workflow&setupStep=operations';
    const { rerender } = render(<AppPage><p>Canonical editor</p></AppPage>);
    expect(screen.getByRole('link', { name: 'Return to setup' })).toHaveAttribute('href', '/organizations/org/setup?step=operations');
    expect(screen.getByText('Canonical editor')).toBeVisible();
    location.query = '';
    rerender(<AppPage><p>Canonical editor</p></AppPage>);
    expect(screen.queryByRole('link', { name: 'Return to setup' })).toBeNull();
    location.path = '/platform/providers'; location.query = 'setupStep=operations';
    rerender(<AppPage><p>Platform editor</p></AppPage>);
    expect(screen.queryByRole('link', { name: 'Return to setup' })).toBeNull();
    location.path = '/organizations/org/work/configuration'; location.query = 'setupStep=https://outside.test';
    rerender(<AppPage><p>Canonical editor</p></AppPage>);
    expect(screen.queryByRole('link', { name: 'Return to setup' })).toBeNull();
  });

});
