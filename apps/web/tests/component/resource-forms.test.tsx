// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateResourceForm } from '@/features/resources/create-resource-form';
import { ResourceCapabilitiesControl } from '@/features/resources/resource-capabilities-control';
import { ResourceClassControl } from '@/features/resources/resource-class-control';
import { ResourceTable } from '@/features/resources/resource-table';
import type { Resource } from '@/lib/domain/resources/resources';
import { runAxe } from '@/tests/support/axe';

/**
 * What a person sees when they say what a resource is. The server actions are replaced — under test
 * is what the forms offer: a type that must be chosen, a member control that exists only for a
 * person, capabilities chosen from the business's words, and a class shown as words.
 */

vi.mock('@/app/organizations/[organizationId]/resources/actions', () => {
  const action = vi.fn(async () => ({ error: null, created: false }));
  return {
    createResourceAction: action,
    setResourceClassAction: action,
    assignResourceCapabilityAction: action,
    removeResourceCapabilityAction: action,
    setResourceMembershipAction: action,
    createCapabilityAction: action,
    renameCapabilityAction: action,
    archiveCapabilityAction: action,
  };
});

afterEach(cleanup);

const capabilities = [
  { id: 'c1', name: 'Tire service', archived: false },
  { id: 'c2', name: 'Oil change', archived: false },
];
const members = [{ membershipId: 'm1', displayName: 'Alex' }];

function renderCreate(mayAddCapability = true) {
  return render(
    <CreateResourceForm
      organizationId="org"
      definitions={[]}
      availableMembers={members}
      capabilities={capabilities}
      mayAddCapability={mayAddCapability}
      formId="f"
    />,
  );
}

describe('creating a resource', () => {
  it('requires a type and preselects none', () => {
    renderCreate();
    const type = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(type.required).toBe(true);
    expect(type.value).toBe('');
    expect([...type.options].map((option) => option.text)).toEqual(['Choose a type', 'Person', 'Vehicle', 'Equipment', 'Facility', 'Other']);
  });

  it('offers the member relationship for a person and for nothing else', () => {
    renderCreate();
    const type = screen.getByLabelText('Type');
    expect(screen.queryByLabelText('Represents member')).toBeNull();

    fireEvent.change(type, { target: { value: 'person' } });
    expect(screen.getByLabelText('Represents member')).toBeTruthy();

    for (const other of ['vehicle', 'equipment', 'facility', 'other']) {
      fireEvent.change(type, { target: { value: other } });
      expect(screen.queryByLabelText('Represents member'), other).toBeNull();
    }
  });

  it('lets capabilities be chosen from the vocabulary, and a new one be typed when the caller may configure', () => {
    renderCreate();
    const group = screen.getByRole('group', { name: 'Capabilities' });
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.parentElement?.textContent)).toEqual(['Tire service', 'Oil change']);
    fireEvent.click(boxes[0]);
    expect(boxes[0].checked).toBe(true);
    expect(screen.getByLabelText('Add a capability')).toBeTruthy();
  });

  it('does not offer to add vocabulary to somebody who may not configure it', () => {
    renderCreate(false);
    expect(screen.queryByLabelText('Add a capability')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderCreate();
    expect(await runAxe(container)).toEqual([]);
  });
});

describe('an existing resource', () => {
  it('shows its type and offers every class on the control', () => {
    render(<ResourceClassControl organizationId="org" resourceId="r1" current="vehicle" />);
    const select = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(select.value).toBe('vehicle');
    expect(select.options).toHaveLength(5);
  });

  it('names each capability removal for what it removes, and offers only what it does not hold', () => {
    render(
      <ResourceCapabilitiesControl
        organizationId="org"
        resourceId="r1"
        resourceName="Service Van 1"
        held={[capabilities[0]]}
        available={[capabilities[1]]}
        mayChange
        mayAddWord
      />,
    );
    expect(screen.getByRole('button', { name: 'Remove Tire service from Service Van 1' })).toBeTruthy();
    const options = [...(screen.getByLabelText('Add a capability') as HTMLSelectElement).options].map((option) => option.text);
    expect(options).toEqual(['Choose…', 'Oil change']);
  });

  it('is read-only for somebody who may not change it', () => {
    render(
      <ResourceCapabilitiesControl
        organizationId="org"
        resourceId="r1"
        resourceName="Alex"
        held={[capabilities[0]]}
        available={[capabilities[1]]}
        mayChange={false}
        mayAddWord={false}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Tire service')).toBeTruthy();
  });
});

describe('the resource list', () => {
  const resource = (over: Partial<Resource>): Resource => ({
    id: 'r',
    name: 'Resource',
    resourceClass: 'other',
    capabilities: [],
    custom: {},
    createdAt: '2027-01-01T00:00:00Z',
    travelMode: null,
    baseLocationId: null,
    member: null,
    ...over,
  });

  it('says each resource’s type in words, with its capabilities and member', () => {
    render(
      <ResourceTable
        organizationId="org"
        definitions={[]}
        resources={[
          resource({ id: 'a', name: 'Alex', resourceClass: 'person', member: { membershipId: 'm1', displayName: 'Alex M' }, capabilities }),
          resource({ id: 'b', name: 'Service Van 1', resourceClass: 'vehicle' }),
        ]}
      />,
    );
    const text = document.body.textContent ?? '';
    for (const expected of ['Person', 'Vehicle', 'Tire service', 'Oil change', 'Alex M']) expect(text).toContain(expected);
  });
});
