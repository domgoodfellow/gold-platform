// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PagePanel, WorkspaceRailProvider } from '@/components/panels/workspace-right-rail';
import { CreateCustomerSheetProvider, CreateCustomerTrigger } from '@/features/crm/customers/create-customer-sheet';
import { OpportunitySheet } from '@/features/crm/opportunities/opportunity-sheet';
import { FollowUpSheet } from '@/features/crm/follow-ups/follow-up-sheet';
import type { FollowUp } from '@/lib/domain/follow-ups/follow-ups';
import type { Opportunity } from '@/lib/domain/opportunities/opportunities';

const customers = vi.hoisted(() => ({ createCustomerAction: vi.fn() }));
const opportunities = vi.hoisted(() => ({ saveOpportunityAction: vi.fn(), searchOpportunityCustomers: vi.fn(), moveOpportunityAction: vi.fn(), saveOpportunityStageAction: vi.fn() }));
const followUps = vi.hoisted(() => ({ saveFollowUpAction: vi.fn(), searchFollowUpOpportunities: vi.fn(), readFollowUpForDrawer: vi.fn(), changeFollowUpStatusAction: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/customers/actions', () => customers);
vi.mock('@/app/organizations/[organizationId]/opportunities/actions', () => opportunities);
vi.mock('@/app/organizations/[organizationId]/follow-ups/actions', () => followUps);
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/organizations/org/sales' }));

const confirmation = () => screen.queryByRole('dialog', { name: 'Discard unsaved changes?' });
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));
function deferred() {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve: (value: unknown) => act(async () => resolve(value)) };
}
function inRail(ui: React.ReactNode) {
  const user = userEvent.setup();
  render(<WorkspaceRailProvider>{ui}<PagePanel /></WorkspaceRailProvider>);
  return user;
}

beforeEach(() => {
  for (const mock of [customers.createCustomerAction, opportunities.saveOpportunityAction, followUps.saveFollowUpAction, router.push, router.refresh]) mock.mockReset();
  opportunities.searchOpportunityCustomers.mockResolvedValue({ customers: [], total: 0 });
  followUps.searchFollowUpOpportunities.mockResolvedValue([]);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  window.matchMedia = vi.fn().mockImplementation((media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('New customer drawer', () => {
  const open = async () => {
    const user = inRail(<CreateCustomerSheetProvider organizationId="org" definitions={[]}><CreateCustomerTrigger /></CreateCustomerSheetProvider>);
    await user.click(screen.getByRole('button', { name: /New customer/ }));
    return { user, drawer: screen.getByRole('dialog', { name: 'New customer' }) };
  };

  it('opens on Name with Add customer and Cancel in the footer, associated with the form', async () => {
    const { drawer } = await open();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    const submit = within(drawer).getByRole('button', { name: 'Add customer' });
    const form = drawer.querySelector('form')!;
    expect(submit).toHaveAttribute('form', form.id);
    expect(form.contains(submit)).toBe(false);
    expect(submit.closest('[data-drawer-footer]')).not.toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Cancel' }).closest('[data-drawer-footer]')).not.toBeNull();
  });

  it('a refused save keeps what was typed and focuses the reason; Escape asks, Keep editing returns', async () => {
    customers.createCustomerAction.mockResolvedValue({ error: 'That email belongs to another customer.', created: false });
    const { user } = await open();
    await user.type(screen.getByLabelText('Name'), 'Harbour View Dental');
    await user.type(screen.getByLabelText(/Email/), 'desk@harbour.example');
    await user.click(screen.getByRole('button', { name: 'Add customer' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('another customer');
    expect(screen.getByLabelText('Name')).toHaveValue('Harbour View Dental');
    expect(screen.getByLabelText(/Email/)).toHaveValue('desk@harbour.example');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(confirmation()).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => expect(confirmation()).toBeNull());
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
  });

  it('submits once while saving, closes on success without asking, and reopens empty', async () => {
    const save = deferred();
    customers.createCustomerAction.mockReturnValue(save.promise);
    const { user } = await open();
    await user.type(screen.getByLabelText('Name'), 'Northgate Bakery');
    await user.click(screen.getByRole('button', { name: 'Add customer' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Adding…' }));
    expect(customers.createCustomerAction).toHaveBeenCalledTimes(1);
    await save.resolve({ error: null, created: true });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New customer' })).toBeNull());
    expect(confirmation()).toBeNull();
    await user.click(screen.getByRole('button', { name: /New customer/ }));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('closes an untouched drawer at once and returns focus to the trigger', async () => {
    const { user } = await open();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmation()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'New customer' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /New customer/ })).toHaveFocus());
  });
});

describe('Opportunity drawer', () => {
  const options = { organizationId: 'org', stages: [], members: [{ id: 'm1', displayName: 'Sanne' }], defaultCurrency: 'EUR' };
  const customer = { id: 'c1', name: 'Harbour View Dental' };

  it('a refused save keeps every value, focuses the reason, and Escape asks before discarding', async () => {
    opportunities.saveOpportunityAction.mockResolvedValue({ error: 'Use a three-letter currency code.', savedId: null });
    const user = inRail(<OpportunitySheet {...options} customer={customer} />);
    await user.click(screen.getByRole('button', { name: 'New opportunity' }));
    await user.type(screen.getByLabelText('Title'), 'Service contract');
    await user.type(screen.getByLabelText(/Value/), '1250');
    await user.click(screen.getByRole('button', { name: 'Save opportunity' }));
    const alert = await screen.findByRole('alert');
    expect(screen.getByLabelText('Title')).toHaveValue('Service contract');
    expect(screen.getByLabelText(/Value/)).toHaveValue('1250');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(confirmation()).not.toBeNull();
  });

  it('on success closes without asking and opens the saved opportunity, as before', async () => {
    const save = deferred();
    opportunities.saveOpportunityAction.mockReturnValue(save.promise);
    const user = inRail(<OpportunitySheet {...options} customer={customer} />);
    await user.click(screen.getByRole('button', { name: 'New opportunity' }));
    await user.type(screen.getByLabelText('Title'), 'Service contract');
    await user.click(screen.getByRole('button', { name: 'Save opportunity' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'Saving…' }));
    expect(opportunities.saveOpportunityAction).toHaveBeenCalledTimes(1);
    await save.resolve({ error: null, savedId: 'opp-1' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/organizations/org/opportunities/opp-1'));
    expect(screen.queryByRole('dialog', { name: 'New opportunity' })).toBeNull();
    expect(confirmation()).toBeNull();
  });

  it('opens an existing opportunity with its saved values and closes at once when unchanged', async () => {
    const opportunity = { id: 'opp-1', customerId: 'c1', customerName: 'Harbour View Dental', title: 'Service contract', stageId: null, amountMinor: 125000, currency: 'EUR', ownerMembershipId: 'm1', expectedCloseOn: '2026-11-01' } as unknown as Opportunity;
    const user = inRail(<OpportunitySheet {...options} opportunity={opportunity} />);
    await user.click(screen.getByRole('button', { name: 'Edit opportunity' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Service contract');
    expect(screen.getByLabelText(/Owner/)).toHaveValue('m1');
    expect(screen.getByLabelText(/Expected close/)).toHaveValue('2026-11-01');
    await settle();
    await user.keyboard('{Escape}');
    expect(confirmation()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Edit opportunity' })).toBeNull();
  });
});

describe('Follow-up drawer', () => {
  const options = { organizationId: 'org', timezone: 'Europe/Amsterdam', members: [{ id: 'm1', displayName: 'Sanne' }] };
  const customer = { id: 'c1', name: 'Harbour View Dental' };
  const item = (over: Partial<FollowUp> = {}): FollowUp => ({
    id: 'f1', customerId: 'c1', customerName: 'Harbour View Dental', opportunityId: null, opportunityTitle: null, kind: 'call', title: 'Call back',
    notes: 'Ask about the second site', dueAt: '2026-10-21T13:00:00.000Z', ownerMembershipId: 'm1', ownerName: 'Sanne', status: 'open', completedAt: null, createdAt: '2026-10-20T09:00:00.000Z', ...over,
  });

  it('a refused save keeps the title, due time and notes it used to clear, and focuses the reason', async () => {
    followUps.saveFollowUpAction.mockResolvedValue({ error: 'Choose a due date and time.', savedId: null });
    const user = inRail(<FollowUpSheet {...options} mayManage customer={customer} />);
    await user.click(screen.getByRole('button', { name: 'New follow-up' }));
    await user.type(screen.getByLabelText('Title'), 'Send the quote');
    await user.type(screen.getByLabelText(/Notes/), 'Include the second site');
    const due = screen.getByLabelText(/Due/) as HTMLInputElement;
    await user.type(due, '2026-10-22T09:30');
    await user.click(screen.getByRole('button', { name: 'Save follow-up' }));
    const alert = await screen.findByRole('alert');
    expect(screen.getByLabelText('Title')).toHaveValue('Send the quote');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Include the second site');
    expect(due.value).toBe('2026-10-22T09:30');
    await waitFor(() => expect(alert.parentElement).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(confirmation()).not.toBeNull();
  });

  it('closes on success without asking and refreshes, as before', async () => {
    const save = deferred();
    followUps.saveFollowUpAction.mockReturnValue(save.promise);
    const user = inRail(<FollowUpSheet {...options} mayManage item={item()} />);
    await user.click(screen.getByRole('button', { name: 'Edit follow-up' }));
    await user.type(screen.getByLabelText(/Notes/), ' and parking');
    await user.click(screen.getByRole('button', { name: 'Save follow-up' }));
    await save.resolve({ error: null, savedId: 'f1' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit follow-up' })).toBeNull());
    expect(router.refresh).toHaveBeenCalled();
    expect(confirmation()).toBeNull();
  });

  it('shows an open follow-up with its saved values; Cancel asks only after a change', async () => {
    const user = inRail(<FollowUpSheet {...options} mayManage item={item()} />);
    await user.click(screen.getByRole('button', { name: 'Edit follow-up' }));
    expect(screen.getByLabelText('Title')).toHaveValue('Call back');
    expect(screen.getByLabelText(/Notes/)).toHaveValue('Ask about the second site');
    await settle();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmation()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit follow-up' }));
    await user.type(screen.getByLabelText(/Notes/), '!');
    await settle();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmation()).not.toBeNull();
  });

  it.each([
    ['a member who may not manage follow-ups', false, item()],
    ['a completed follow-up', true, item({ status: 'completed', completedAt: '2026-10-20T15:00:00.000Z' })],
  ])('is read-only for %s: no footer actions, and it closes at once', async (_label, mayManage, followUp) => {
    const user = inRail(<FollowUpSheet {...options} mayManage={mayManage} item={followUp}>Open it</FollowUpSheet>);
    await user.click(screen.getByRole('button', { name: 'Open it' }));
    const drawer = screen.getByRole('dialog', { name: 'Follow-up' });
    expect(within(drawer).queryByRole('button', { name: 'Save follow-up' })).toBeNull();
    expect(drawer.querySelector('[data-drawer-footer]')).toBeNull();
    await user.click(within(drawer).getByRole('button', { name: 'Close' }));
    expect(confirmation()).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Follow-up' })).toBeNull();
  });
});
