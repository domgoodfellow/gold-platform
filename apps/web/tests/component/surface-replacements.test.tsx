// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Campaign } from '@/lib/domain/marketing/marketing';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { Role } from '@/lib/domain/tenancy/roles';

/**
 * Batch B: surfaces replaced because they were disproportionate to their task. Each test drives the
 * real component and asserts the user-visible contract — which surface opens, what it keeps, how it
 * refuses, and where focus goes — never only that a component is imported.
 */

const marketing = vi.hoisted(() => ({ marketingCommandAction: vi.fn(), previewAudienceAction: vi.fn(), inspectInquiryAction: vi.fn(), searchMarketingCustomersAction: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/marketing/actions', () => marketing);
const pricing = vi.hoisted(() => ({ createPriceItemAction: vi.fn(), updatePriceItemAction: vi.fn(), chooseCurrencyAction: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/finance/configuration/pricing/actions', () => pricing);
const access = vi.hoisted(() => ({ inviteMemberAction: vi.fn(), addMemberAction: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/settings/access/actions', () => access);
const studio = vi.hoisted(() => ({ setPortalFormAction: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/studio/forms/actions', () => studio);
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/organizations/org/x' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { Lifecycle } = await import('@/features/marketing/editors');
const { PricingManagement } = await import('@/features/pricing/pricing-management');
const { AddMemberDialogProvider, AddMemberTrigger } = await import('@/features/team/add-member-dialog');
const { CustomizeHome } = await import('@/features/home/home-dashboard');
const { FormSharing } = await import('@/features/studio/forms/form-sharing');
const { ConfigureMenu } = await import('@/components/controls/configure-menu');

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));
const campaign = { id: 'c1', name: 'Spring push', status: 'draft' } as Campaign;
const items: PriceBookItem[] = [
  { id: 'p1', name: 'Callout', unit: 'visit', unitAmountMinor: 7500, currency: 'EUR', createdAt: '' },
  { id: 'p2', name: 'Hourly', unit: 'hour', unitAmountMinor: 4000, currency: 'EUR', createdAt: '' },
];

beforeEach(() => {
  for (const group of [marketing, pricing, access, studio]) for (const fn of Object.values(group)) fn.mockReset();
  router.refresh.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Campaign status change is a dialog', () => {
  it('confirms in a dialog named for the action, and Cancel returns focus without a command', async () => {
    const user = userEvent.setup();
    render(<Lifecycle organizationId="org" campaign={campaign} />);
    const activate = screen.getByRole('button', { name: 'Activate' });
    await user.click(activate);
    const dialog = screen.getByRole('dialog', { name: 'Activate campaign?' });
    expect(dialog).toHaveAttribute('role', 'dialog');
    expect(dialog.closest('[data-slot="dialog-content"]') ?? dialog).toBeTruthy();
    expect(screen.queryByText('Confirm campaign change')).toBeNull();
    expect(within(dialog).getByText(/does not send messages/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(marketing.marketingCommandAction).not.toHaveBeenCalled();
    await waitFor(() => expect(activate).toHaveFocus());
  });

  it('keeps a domain refusal in the dialog, and closes and refreshes on success', async () => {
    const user = userEvent.setup();
    render(<Lifecycle organizationId="org" campaign={campaign} />);
    marketing.marketingCommandAction.mockResolvedValueOnce({ error: 'Add a planned end date before activating.' });
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activate' }));
    expect(await within(screen.getByRole('dialog')).findByText('Add a planned end date before activating.')).toBeVisible();
    expect(marketing.marketingCommandAction).toHaveBeenCalledWith('org', 'campaign.status', { id: 'c1', status: 'active' });
    marketing.marketingCommandAction.mockResolvedValueOnce({ error: null });
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(router.refresh).toHaveBeenCalled();
  });

  it('closes with Escape', async () => {
    const user = userEvent.setup();
    render(<Lifecycle organizationId="org" campaign={campaign} />);
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    expect(screen.getByRole('dialog', { name: 'Archive campaign?' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Add member is a focused dialog', () => {
  const roles = [{ id: 'r1', name: 'Dispatcher' }] as Role[];
  const renderTeam = () => { const user = userEvent.setup(); render(<AddMemberDialogProvider organizationId="org" roles={roles}><AddMemberTrigger /></AddMemberDialogProvider>); return user; };

  it('opens a dialog defaulting to invite by email, and Escape returns focus to the trigger', async () => {
    const user = renderTeam();
    const trigger = screen.getByRole('button', { name: 'Add member' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Add member' });
    expect(dialog.closest('[data-slot="dialog-content"]') ?? dialog.querySelector('[data-slot]')).toBeTruthy();
    expect(document.querySelector('[data-drawer-body]')).toBeNull();
    expect(within(dialog).getByRole('tab', { name: 'Invite by email', selected: true })).toBeVisible();
    expect(within(dialog).getByLabelText('Email address')).toBeVisible();
    expect(within(dialog).getByLabelText('Role')).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('shows a truthful not-emailed result with the copy-link fallback, and stays open', async () => {
    access.inviteMemberAction.mockResolvedValueOnce({ error: null, link: 'http://localhost/organizations/accept-invite/abc', email: { accepted: false, reason: 'Email sending is not configured.' } });
    const user = renderTeam();
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    const dialog = screen.getByRole('dialog', { name: 'Add member' });
    await user.type(within(dialog).getByLabelText('Email address'), 'new@example.test');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText(/Invitation created, but it was not emailed\. Email sending is not configured\./)).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: /Invitation link/ })).toHaveValue('http://localhost/organizations/accept-invite/abc');
  });

  it('says accepted for delivery, not delivered, and keeps the link behind a choice', async () => {
    access.inviteMemberAction.mockResolvedValueOnce({ error: null, link: 'http://localhost/organizations/accept-invite/def', email: { accepted: true } });
    const user = renderTeam();
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    const dialog = screen.getByRole('dialog', { name: 'Add member' });
    await user.type(within(dialog).getByLabelText('Email address'), 'known@example.test');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText(/accepted it for delivery/)).toBeVisible();
    expect(within(dialog).queryByRole('textbox', { name: /Invitation link/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Copy the invitation link instead' }));
    expect(within(dialog).getByRole('textbox', { name: /Invitation link/ })).toBeVisible();
  });

  it('shows an authorization refusal in the dialog', async () => {
    access.inviteMemberAction.mockResolvedValueOnce({ error: 'You cannot invite people to this business.', link: null, email: null });
    const user = renderTeam();
    await user.click(screen.getByRole('button', { name: 'Add member' }));
    const dialog = screen.getByRole('dialog', { name: 'Add member' });
    await user.type(within(dialog).getByLabelText('Email address'), 'x@example.test');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('You cannot invite people to this business.');
  });
});

describe('Customize Home is a popover', () => {
  it('opens anchored to Customize, toggles a panel at once, and Escape returns focus', async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    render(<CustomizeHome hidden={['activity']} toggle={toggle} />);
    const trigger = screen.getByRole('button', { name: 'Customize' });
    await user.click(trigger);
    const panel = screen.getByRole('dialog', { name: 'Customize Home' });
    expect(panel).toHaveAttribute('data-slot', 'popover-content');
    expect(within(panel).getByRole('checkbox', { name: 'Business performance' })).toBeChecked();
    expect(within(panel).getByRole('checkbox', { name: 'Recent activity' })).not.toBeChecked();
    await user.click(within(panel).getByRole('checkbox', { name: 'Recent activity' }));
    expect(toggle).toHaveBeenCalledWith('activity');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('Form sharing is a section of the form page', () => {
  const props = { organizationId: 'org', formId: 'f1', formSlug: 'enquiry', publicKey: 'pk1', organizationSlug: 'acme', siteHostname: null, origin: 'http://localhost', placements: { websitePublished: false, websiteDraft: false, portal: false, booking: false } };

  it('renders inline with its links, placements and embed when published, and no drawer', () => {
    render(<FormSharing {...props} published />);
    const section = screen.getByRole('region', { name: 'Sharing' });
    expect(section).toHaveAttribute('id', 'sharing');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Distribute' })).toBeNull();
    expect(within(section).getByRole('textbox', { name: 'Form link' })).toHaveValue('http://localhost/f/pk1');
    expect(within(section).getByRole('region', { name: 'Embed' })).toBeVisible();
    expect(within(section).getByRole('region', { name: 'Used by' })).toHaveTextContent('Nowhere yet.');
  });

  it('withholds links until published, and reports a refused portal change', async () => {
    studio.setPortalFormAction.mockResolvedValueOnce({ error: 'Publish the form before offering it in the portal.' });
    const user = userEvent.setup();
    render(<FormSharing {...props} published={false} />);
    const section = screen.getByRole('region', { name: 'Sharing' });
    expect(within(section).getByText(/Publish this form to share it/)).toBeVisible();
    expect(within(section).queryByRole('region', { name: 'Link' })).toBeNull();
    await user.click(within(section).getByRole('button', { name: 'Add to portal' }));
    expect(await within(section).findByRole('alert')).toHaveTextContent('Publish the form before offering it in the portal.');
    expect(studio.setPortalFormAction).toHaveBeenCalledWith({ organizationId: 'org', formId: 'f1', enabled: true });
  });
});

describe('Price items are managed in their rows', () => {
  const renderBook = (mayManage = true) => { const user = userEvent.setup(); render(<PricingManagement organizationId="org" items={items} currency="EUR" mayManage={mayManage} />); return user; };

  it('edits one row in place, holding the other rows until it is finished, and Escape cancels back to Edit', async () => {
    const user = renderBook();
    const edit = screen.getByRole('button', { name: 'Edit Callout' });
    await user.click(edit);
    const row = screen.getByRole('form', { name: 'Edit Callout' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(row).getByLabelText('Name of Callout')).toHaveFocus();
    expect(within(row).getByLabelText('Amount in EUR for Callout')).toHaveValue(75);
    expect(screen.getByRole('button', { name: 'Edit Hourly' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add price item' })).toBeDisabled();
    await user.clear(within(row).getByLabelText('Name of Callout'));
    await user.type(within(row).getByLabelText('Name of Callout'), 'Emergency callout');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'Edit Callout' })).toBeNull();
    expect(screen.getByText('Callout')).toBeVisible();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Callout' })).toHaveFocus());
    expect(pricing.updatePriceItemAction).not.toHaveBeenCalled();
  });

  it('keeps typed values and focuses the reason when a save is refused, then closes on success', async () => {
    const user = renderBook();
    pricing.updatePriceItemAction.mockResolvedValueOnce({ error: 'You already price something called Hourly.' });
    await user.click(screen.getByRole('button', { name: 'Edit Callout' }));
    const row = screen.getByRole('form', { name: 'Edit Callout' });
    await user.clear(within(row).getByLabelText('Name of Callout'));
    await user.type(within(row).getByLabelText('Name of Callout'), 'Hourly');
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    const alert = await within(row).findByRole('alert');
    expect(alert).toHaveTextContent('You already price something called Hourly.');
    await waitFor(() => expect(alert).toHaveFocus());
    expect(within(row).getByLabelText('Name of Callout')).toHaveValue('Hourly');
    const sent = pricing.updatePriceItemAction.mock.calls[0][1] as FormData;
    expect([sent.get('itemId'), sent.get('name'), sent.get('unit'), sent.get('amount')]).toEqual(['p1', 'Hourly', 'visit', '75.00']);
    pricing.updatePriceItemAction.mockResolvedValueOnce({ error: null, success: 'Saved.' });
    await user.clear(within(row).getByLabelText('Name of Callout'));
    await user.type(within(row).getByLabelText('Name of Callout'), 'Callout fee');
    await user.click(within(row).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit Callout' })).toBeNull());
  });

  it('adds a new item in a row at the top, with the currency fixed to the business', async () => {
    const user = renderBook();
    pricing.createPriceItemAction.mockResolvedValueOnce({ error: null, success: 'Saved.' });
    await user.click(screen.getByRole('button', { name: 'Add price item' }));
    const row = screen.getByRole('form', { name: 'Add price item' });
    expect(within(row).getByLabelText('Name of new price item')).toHaveFocus();
    expect(within(row).getByText('EUR')).toBeVisible();
    await user.type(within(row).getByLabelText('Name of new price item'), 'Delivery');
    await user.type(within(row).getByLabelText('Unit of new price item'), 'trip');
    await user.type(within(row).getByLabelText('Amount in EUR for new price item'), '40');
    await user.click(within(row).getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Add price item' })).toBeNull());
    const sent = pricing.createPriceItemAction.mock.calls[0][1] as FormData;
    expect([sent.get('name'), sent.get('unit'), sent.get('amount'), sent.get('currency')]).toEqual(['Delivery', 'trip', '40', null]);
    await settle();
  });

  it('offers no editing to a member who may only read prices', () => {
    renderBook(false);
    expect(screen.getByText('Callout')).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add price item' })).toBeNull();
  });
});

describe('Configure menu separates Organization Settings pages', () => {
  it('groups Settings-owned doors under their owner after the workspace own doors', async () => {
    const user = userEvent.setup();
    render(<ConfigureMenu items={[
      { key: 'call-setup', label: 'Calling & routing', href: '/o/comms/configuration/calling' },
      { key: 'email', label: 'Email sending', href: '/o/settings/email', owner: 'settings' },
    ]} />);
    await user.click(screen.getByRole('button', { name: 'Configure' }));
    const menu = await screen.findByRole('menu');
    const group = within(menu).getByRole('group', { name: 'Organization settings' });
    expect(within(group).getByRole('menuitem', { name: 'Email sending' })).toHaveAttribute('href', '/o/settings/email');
    expect(within(group).queryByRole('menuitem', { name: 'Calling & routing' })).toBeNull();
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Calling & routing', 'Email sending']);
  });

  it('names a lone Settings door for its owner', () => {
    render(<ConfigureMenu items={[{ key: 'branding', label: 'Branding', href: '/o/settings/branding', owner: 'settings' }]} />);
    expect(screen.getByRole('link', { name: /Branding/ })).toHaveAttribute('title', 'Branding (Organization settings)');
  });
});
