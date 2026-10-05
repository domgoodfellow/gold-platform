// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CreateTypeForm,
  PublishTypeForm,
  SchedulingTypeForm,
} from '@/features/work/configuration/work-config-forms';
import { runAxe } from '@/tests/support/axe';

/**
 * The scheduling declaration as a person meets it on Work configuration: asked explicitly when a
 * kind of work is created, changeable afterwards, and never a way to publish work that is not
 * scheduled. The server actions are replaced — what is under test is what the form offers.
 */

vi.mock('@/features/work/configuration/actions', () => {
  const action = vi.fn(async () => ({ error: null }));
  return {
    setTypeBookingIntakeAction: action,
    addTypeChecklistItemAction: action,
    createStatusAction: action,
    createTransitionAction: action,
    createTypeAction: action,
    removeTypeChecklistItemAction: action,
    renameTypeAction: action,
    setTypeBookableAction: action,
    setTypeSchedulableAction: action,
    updateStatusAction: action,
  };
});

afterEach(cleanup);

describe('creating a kind of work', () => {
  it('asks whether it is scheduled and leaves both answers unchosen', () => {
    render(<CreateTypeForm organizationId="org" />);

    const scheduled = screen.getByRole('radio', { name: /^Scheduled/ }) as HTMLInputElement;
    const unscheduled = screen.getByRole('radio', { name: /^Not scheduled/ }) as HTMLInputElement;
    expect(scheduled.checked).toBe(false);
    expect(unscheduled.checked).toBe(false);
    // A form cannot be submitted without choosing — the platform does not answer for the business.
    expect(scheduled.required && unscheduled.required).toBe(true);
    // In a business's words, not the column's.
    expect(screen.getByText('This work happens at a time and can appear in Schedule.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/schedulable/i);
  });

  it('has no accessibility violations', async () => {
    const { container } = render(<CreateTypeForm organizationId="org" />);
    expect(await runAxe(container)).toEqual([]);
  });
});

describe('changing whether a kind of work is scheduled', () => {
  const props = { organizationId: 'org', typeId: 't1', typeName: 'Oil change', disabled: false };

  it('shows the current declaration', () => {
    render(<SchedulingTypeForm {...props} schedulable published={false} />);
    expect((screen.getByRole('checkbox', { name: 'Oil change is scheduled' }) as HTMLInputElement).checked).toBe(true);
  });

  it('says why a type on the public page has to stay scheduled', () => {
    render(<SchedulingTypeForm {...props} schedulable published />);
    expect(screen.getByText(/needs it to stay scheduled/)).toBeTruthy();
  });

  it('cannot be changed by somebody without the configuration permission', () => {
    render(<SchedulingTypeForm {...props} schedulable={false} published={false} disabled />);
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('publishing a kind of work to the booking page', () => {
  const props = {
    organizationId: 'org',
    typeId: 't1',
    typeName: 'Sales opportunity',
    statuses: [{ id: 's1', name: 'Open', position: 0, releasesResource: false, marksComplete: false }],
    prices: [],
    booking: null,
    intakeForms: [] as Array<{ id: string; name: string }>,
    disabled: false,
  };

  it('offers nothing for work that is not scheduled, and says what to do first', () => {
    render(<PublishTypeForm {...props} schedulable={false} />);
    expect(screen.getByText(/is not scheduled, so it cannot be booked/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('offers the form for work that is', () => {
    render(<PublishTypeForm {...props} typeName="Oil change" schedulable />);
    expect(screen.queryByText(/cannot be booked/)).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('asks for no questions until the kind of work is on the booking page', () => {
    render(<PublishTypeForm {...props} schedulable intakeForms={[{ id: 'f1', name: 'Service intake' }]} />);
    expect(screen.queryByLabelText(/Additional questions/)).toBeNull();
  });

  it('lets a published kind of work pick one of the business’s forms, and links to Studio to edit it', () => {
    render(
      <PublishTypeForm
        {...props}
        schedulable
        booking={{ statusId: 's1', durationMinutes: 30, priceItemId: null, intakeFormId: 'f1' }}
        intakeForms={[{ id: 'f1', name: 'Service intake' }, { id: 'f2', name: 'Vehicle details' }]}
      />,
    );
    const select = screen.getByLabelText(/Additional questions/) as HTMLSelectElement;
    expect(select.value).toBe('f1');
    expect([...select.options].map((option) => option.text)).toEqual(['No additional questions', 'Service intake', 'Vehicle details']);
    expect(screen.getByRole('link', { name: 'Edit the form' }).getAttribute('href')).toBe('/organizations/org/studio/forms/f1');
  });

  it('says what to do when there is no form to ask', () => {
    render(<PublishTypeForm {...props} schedulable booking={{ statusId: 's1', durationMinutes: 30, priceItemId: null, intakeFormId: null }} />);
    expect(screen.getByText('Publish a form in Studio to ask questions at booking.')).toBeTruthy();
  });
});
