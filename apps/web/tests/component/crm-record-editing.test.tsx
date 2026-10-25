// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from 'lucide-react';
import { EditContactDialog } from '@/features/crm/customers/edit-contact-dialog';
import { EntityIdentity, EntityRow } from '@/components/display/entity-row';
import { StatusSummary } from '@/components/display/status-summary';
import { CollectionToolbar } from '@/components/patterns/collection-toolbar';
import { ConfigurationEditor } from '@/components/patterns/configuration-editor';
import { RecordSubnavigation } from '@/components/navigation/record-subnavigation';
import type { Contact } from '@/lib/domain/contacts/contacts';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';

const actions = vi.hoisted(() => ({ editCustomerAction: vi.fn() }));
vi.mock('@/app/organizations/[organizationId]/crm/contacts/[contactId]/actions', () => actions);
vi.mock('@/app/organizations/[organizationId]/crm/contacts/actions', () => ({ createCustomerAction: vi.fn(), companyOptionsAction: vi.fn(async () => []) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/organizations/org/crm' }));

const contact = (extra: Partial<Contact> = {}): Contact => ({ id: 'c1', name: 'Harbour View', email: 'desk@harbour.test', phone: null, custom: { industry: 'Marine' }, stageId: null, contactType: 'company', lifecycle: 'customer', leadTemperature: 'unrated', createdAt: '2026-10-01T00:00:00Z', ...extra });
const industry = { id: 'f1', key: 'industry', label: 'Industry', kind: 'text', entityType: 'customer', required: false, options: [], position: 0, createdAt: '2026-01-01' } as FieldDefinition;
const confirmation = () => screen.queryByRole('alertdialog', { name: 'Discard unsaved changes?' });
beforeEach(() => { actions.editCustomerAction.mockReset(); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Edit contact dialog', () => {
  it('edits in focused sections without losing values, and saves through the canonical action', async () => {
    actions.editCustomerAction.mockResolvedValue({ error: null, updated: true });
    const user = userEvent.setup();
    render(<EditContactDialog organizationId="org" customer={contact()} definitions={[industry]} stages={[{ id: 's1', name: 'Onboarding', position: 0 } as never]} />);
    await user.click(screen.getByRole('button', { name: /Edit/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit contact' });
    expect(within(dialog).queryByText(/Edit contact details, lifecycle/)).toBeNull();
    await user.clear(within(dialog).getByLabelText('Company name')); await user.type(within(dialog).getByLabelText('Company name'), 'Harbour View Ltd');
    await user.click(within(dialog).getByRole('button', { name: 'Relationship' }));
    expect(within(dialog).getByLabelText('Lifecycle')).toHaveValue('customer');
    await user.selectOptions(within(dialog).getByLabelText(/^Relationship stage/), 's1');
    await user.click(within(dialog).getByRole('button', { name: 'Additional fields' }));
    expect(within(dialog).getByLabelText(/Industry/)).toHaveValue('Marine');
    await user.click(within(dialog).getByRole('button', { name: 'Identity & essentials' }));
    expect(within(dialog).getByLabelText('Company name')).toHaveValue('Harbour View Ltd');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(Object.fromEntries(actions.editCustomerAction.mock.calls[0][1] as FormData)).toMatchObject({ customerId: 'c1', contactType: 'company', name: 'Harbour View Ltd', lifecycle: 'customer', stageId: 's1', custom_industry: 'Marine' });
  });

  it('keeps the stored relationship stage when the business offers no stage control', async () => {
    actions.editCustomerAction.mockResolvedValue({ error: null, updated: true });
    const user = userEvent.setup();
    render(<EditContactDialog organizationId="org" customer={contact({ stageId: 'kept' })} definitions={[]} stages={[]} />);
    await user.click(screen.getByRole('button', { name: /Edit/ }));
    expect(screen.queryByRole('button', { name: 'Additional fields' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(actions.editCustomerAction).toHaveBeenCalled());
    expect((actions.editCustomerAction.mock.calls[0][1] as FormData).get('stageId')).toBe('kept');
  });

  it('classifies an Unspecified record explicitly and asks before discarding a change', async () => {
    const user = userEvent.setup();
    render(<EditContactDialog organizationId="org" customer={contact({ contactType: 'unspecified', lifecycle: null })} definitions={[]} stages={[]} label="Classify contact" initialSection="identity" icon={false} />);
    const trigger = screen.getByRole('button', { name: 'Classify contact' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Classify and edit contact' });
    for (const choice of ['Person', 'Company', 'Not decided']) expect(within(dialog).getByRole('radio', { name: new RegExp(choice) })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Not decided/ })).toBeChecked();
    await user.click(within(dialog).getByText('Company', { exact: true }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(confirmation()).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(within(dialog).getByRole('radio', { name: /Company/ })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('shared presentation contracts', () => {
  it('EntityRow leads with identity, speaks the identity type, and links only the name', () => {
    render(<ul><EntityRow identity={<EntityIdentity icon={User} kind="Person" name="Ada" href="/c/ada" secondary="Acme" />} activity="Call completed" timestamp="Oct 1" /></ul>);
    expect(screen.getByRole('link', { name: 'Ada' })).toHaveAttribute('href', '/c/ada');
    expect(screen.getByText('Person')).toHaveClass('sr-only');
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });
  it('StatusSummary labels each classification and omits empty ones', () => {
    render(<StatusSummary label="Classification" items={[{ label: 'Lifecycle', value: 'Customer' }, { label: 'Stage', value: '' }]} />);
    const list = screen.getByLabelText('Classification');
    expect(list).toHaveTextContent('LifecycleCustomer');
    expect(list).not.toHaveTextContent('Stage');
  });
  it('CollectionToolbar keeps the URL as the view model and lists removable active filters', () => {
    render(<CollectionToolbar action="/contacts" scopes={[{ key: 'all', label: 'All', href: '/contacts', current: true }]} search={{ name: 'q', value: 'ada', label: 'Search contacts' }} hidden={{ contactType: 'person' }}
      filters={<label>Lifecycle<select name="lifecycle" /></label>} filterCount={1} active={[{ key: 'lifecycle', label: 'Lifecycle: Lead', removeHref: '/contacts' }]} resetHref="/contacts" />);
    expect(screen.getByRole('search')).toHaveAttribute('action', '/contacts');
    expect(screen.getByRole('searchbox', { name: 'Search contacts' })).toHaveValue('ada');
    expect(document.querySelector('input[type=hidden][name=contactType]')).toHaveValue('person');
    expect(screen.getByText('Filters').closest('summary')).toHaveTextContent('Filters1');
    expect(screen.getByRole('link', { name: /Lifecycle: Lead/ })).toHaveAttribute('href', '/contacts');
    expect(screen.getByRole('link', { name: 'Reset' })).toBeInTheDocument();
  });
  it('ConfigurationEditor numbers items in stored order and shows a compact first-run state', () => {
    const { rerender } = render(<ConfigurationEditor label="Stages" items={[{ id: 'b', label: 'Second' }, { id: 'a', label: 'First' }]} empty="None yet." />);
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['1Second', '2First']);
    rerender(<ConfigurationEditor label="Stages" items={[]} empty="None yet." addAction={<button>Add stage</button>} />);
    expect(screen.getByText('None yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add stage' })).toBeInTheDocument();
  });
  it('RecordSubnavigation marks the current section and shows sub-sections only when there is a choice', () => {
    const { rerender } = render(<RecordSubnavigation label="Contact sections" sections={[{ key: 'overview', label: 'Overview', href: '/c' }, { key: 'sales', label: 'Sales', href: '/c?section=sales' }]} current="sales"
      subsections={[{ key: 'opportunities', label: 'Opportunities', href: '/o' }, { key: 'discovery', label: 'Discovery', href: '/d' }]} currentSubsection="discovery" />);
    expect(screen.getByRole('link', { name: 'Sales' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Discovery' })).toHaveAttribute('aria-current', 'page');
    rerender(<RecordSubnavigation label="Contact sections" sections={[{ key: 'overview', label: 'Overview', href: '/c' }]} current="overview" subsections={[{ key: 'timeline', label: 'Timeline', href: '/t' }]} />);
    expect(screen.queryByRole('navigation', { name: 'Contact sections: sections' })).toBeNull();
  });
});
