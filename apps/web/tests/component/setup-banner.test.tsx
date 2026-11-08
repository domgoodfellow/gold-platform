// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupBanner } from '@/features/setup/setup-banner';
import type { SetupOverview } from '@/lib/domain/tenancy/lifecycle';

vi.mock('next/link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

const ORG = 'org-1';
const SETUP = `/organizations/${ORG}/setup`;

/** Only the counts the banner reads matter here; `blockers` is the authoritative required list. */
function overview(required: number, optional = 0): SetupOverview {
  const blocker = (key: string) => ({
    key,
    label: key,
    message: `${key} needs setup`,
    area: { href: `/organizations/${ORG}/settings/${key}`, label: key },
    state: 'incomplete' as const,
    importance: 'required' as const,
  });
  return {
    areas: [],
    blockers: Array.from({ length: required }, (_, index) => blocker(`required-${index}`)),
    ready: 0,
    total: required + optional,
    recommendedOpen: 0,
    optionalOpen: optional,
  };
}

describe('organization setup banner on Home', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
  });

  it('names the required steps that remain, with a direct review action, for someone who can launch', () => {
    render(<SetupBanner organizationId={ORG} overview={overview(2)} mayLaunch />);
    const banner = screen.getByRole('region', { name: 'Organization setup' });
    expect(within(banner).getByRole('heading', { name: 'Setup required — 2 required steps remain before launch.' })).toBeInTheDocument();
    expect(within(banner).getByRole('link', { name: 'Review setup' })).toHaveAttribute('href', SETUP);
  });

  it('uses the singular for one remaining step', () => {
    render(<SetupBanner organizationId={ORG} overview={overview(1)} mayLaunch />);
    expect(screen.getByRole('heading', { name: 'Setup required — 1 required step remains before launch.' })).toBeInTheDocument();
  });

  it('shows the same gap to someone who cannot launch as information, with no instruction to act', () => {
    render(<SetupBanner organizationId={ORG} overview={overview(2)} mayLaunch={false} />);
    expect(screen.queryByText(/Setup required/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Setup in progress' })).toBeInTheDocument();
    expect(screen.getByText(/An organization manager can finish setup/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View setup' })).toHaveAttribute('href', SETUP);
  });

  it('is ready to launch when only optional or recommended areas are open', () => {
    render(<SetupBanner organizationId={ORG} overview={overview(0, 4)} mayLaunch />);
    expect(screen.getByRole('heading', { name: 'Ready to launch' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review and launch' })).toHaveAttribute('href', SETUP);
    expect(screen.queryByText(/required/)).not.toBeInTheDocument();
  });

  it('tells someone who cannot launch that the business is ready, without a launch action', () => {
    render(<SetupBanner organizationId={ORG} overview={overview(0)} mayLaunch={false} />);
    expect(screen.getByRole('heading', { name: 'Ready to launch' })).toBeInTheDocument();
    expect(screen.getByText(/An organization manager can launch this business/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review and launch' })).not.toBeInTheDocument();
  });

  it('says so plainly when the checklist cannot be read', () => {
    render(<SetupBanner organizationId={ORG} overview={null} mayLaunch />);
    expect(screen.getByRole('heading', { name: 'Setup status is unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review setup' })).toHaveAttribute('href', SETUP);
  });

  it('can be closed, stays closed on the next visit, and returns when the remaining steps change', () => {
    const first = render(<SetupBanner organizationId={ORG} overview={overview(2)} mayLaunch />);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Close setup notice' })));
    expect(screen.queryByRole('region', { name: 'Organization setup' })).not.toBeInTheDocument();
    first.unmount();

    // A reload in the same session: still closed while two steps remain.
    render(<SetupBanner organizationId={ORG} overview={overview(2)} mayLaunch />);
    expect(screen.queryByRole('region', { name: 'Organization setup' })).not.toBeInTheDocument();
    cleanup();

    // One step done: the banner is back.
    render(<SetupBanner organizationId={ORG} overview={overview(1)} mayLaunch />);
    expect(screen.getByRole('heading', { name: 'Setup required — 1 required step remains before launch.' })).toBeInTheDocument();
  });

  it('is closed per business', () => {
    render(<SetupBanner organizationId={ORG} overview={overview(2)} mayLaunch />);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Close setup notice' })));
    cleanup();
    render(<SetupBanner organizationId="org-2" overview={overview(2)} mayLaunch />);
    expect(screen.getByRole('region', { name: 'Organization setup' })).toBeInTheDocument();
  });
});
