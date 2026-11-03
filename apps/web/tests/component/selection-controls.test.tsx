// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldLabel } from '@/components/controls/inputs';
import { PeriodSelect } from '@/components/controls/period-select';
import { SEARCHABLE_FROM, SelectField, SuggestionField, type SelectOption } from '@/components/controls/select-field';
import { chooseOption, fieldInput, fieldValue } from '../support/select-field';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
afterEach(() => { cleanup(); push.mockReset(); });

const STAGES: SelectOption[] = [{ value: '', label: 'No stage' }, { value: 's1', label: 'Lead' }, { value: 's2', label: 'Won' }, { value: 's3', label: 'Lost', disabled: true }];
const formOf = (element: HTMLElement) => Object.fromEntries(new FormData(element.closest('form')!));

describe('SelectField (styled Select)', () => {
  it('names its trigger from a visible label, submits the domain value and keeps a real empty choice', async () => {
    render(<form><FieldLabel htmlFor="stage">Stage</FieldLabel><SelectField id="stage" name="stageId" defaultValue="s1" options={STAGES} aria-describedby="hint" /><p id="hint">Where it is now</p></form>);
    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    expect(trigger).toHaveAttribute('aria-describedby', 'hint');
    expect(trigger).toHaveTextContent('Lead');
    expect(formOf(trigger)).toEqual({ stageId: 's1' });
    await chooseOption(trigger, 'No stage');
    // "None" persists as the empty string, exactly as the native field submitted it.
    expect(formOf(trigger)).toEqual({ stageId: '' });
    expect(trigger).toHaveTextContent('No stage');
    await chooseOption(trigger, 's2');
    expect(formOf(trigger)).toEqual({ stageId: 's2' });
  });

  it('starts on the first enabled option without a default, as a native select does, unless a placeholder says otherwise', () => {
    render(<form><SelectField aria-label="Plain" name="plain" options={STAGES.slice(1)} /><SelectField aria-label="Asked" name="asked" placeholder="Choose a stage" options={STAGES.slice(1)} /></form>);
    expect(fieldValue(screen.getByRole('combobox', { name: 'Plain' }))).toBe('s1');
    expect(fieldValue(screen.getByRole('combobox', { name: 'Asked' }))).toBe('');
    expect(screen.getByRole('combobox', { name: 'Asked' })).toHaveTextContent('Choose a stage');
  });

  it('marks the chosen option and refuses a disabled one', async () => {
    render(<SelectField aria-label="Stage" defaultValue="s2" options={STAGES} />);
    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    await act(async () => { fireEvent.click(trigger); });
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'Won' })).toHaveAttribute('aria-selected', 'true');
    expect(within(listbox).getByRole('option', { name: 'Lost' })).toHaveAttribute('data-disabled');
    await act(async () => { fireEvent.click(within(listbox).getByRole('option', { name: 'Lost' })); });
    expect(fieldValue(trigger)).toBe('s2');
  });

  it('is operated by keyboard: arrows open it, Enter chooses, Escape closes and returns focus to the trigger', async () => {
    const changed = vi.fn();
    render(<SelectField aria-label="Stage" defaultValue="s1" options={STAGES} onValueChange={changed} />);
    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    trigger.focus();
    await act(async () => { fireEvent.keyDown(trigger, { key: 'ArrowDown' }); });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: 'Lead' })).toHaveFocus());
    await act(async () => { fireEvent.keyDown(screen.getByRole('option', { name: 'Lead' }), { key: 'ArrowDown' }); });
    await waitFor(() => expect(screen.getByRole('option', { name: 'Won' })).toHaveFocus());
    await act(async () => { fireEvent.keyDown(screen.getByRole('option', { name: 'Won' }), { key: 'Enter' }); });
    expect(changed).toHaveBeenCalledWith('s2');
    await waitFor(() => expect(trigger).toHaveFocus());
    await act(async () => { fireEvent.keyDown(trigger, { key: 'Enter' }); });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); });
    expect(screen.queryByRole('listbox')).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('follows its owner when controlled and reports the value, never an event', async () => {
    const seen: string[] = [];
    function Owner() {
      const [value, setValue] = useState('s1');
      return <><SelectField aria-label="Stage" value={value} onValueChange={next => { seen.push(next); setValue(next); }} options={STAGES} /><button type="button" onClick={() => setValue('s2')}>Win it</button></>;
    }
    render(<Owner />);
    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    fireEvent.click(screen.getByRole('button', { name: 'Win it' }));
    expect(trigger).toHaveTextContent('Won');
    expect(fieldValue(trigger)).toBe('s2');
    await chooseOption(trigger, 'Lead');
    expect(seen).toEqual(['s1']);
  });

  it('holds back an empty required choice through constraint validation, and sends the browser to the trigger', async () => {
    render(<form><SelectField aria-label="Type" name="type" required placeholder="Choose a type" options={STAGES.slice(1)} /></form>);
    const trigger = screen.getByRole('combobox', { name: 'Type' });
    expect(trigger).toHaveAttribute('aria-required', 'true');
    expect(fieldInput(trigger).checkValidity()).toBe(false);
    fieldInput(trigger).focus();
    expect(trigger).toHaveFocus();
    await chooseOption(trigger, 's1');
    expect(fieldInput(trigger).checkValidity()).toBe(true);
  });

  it('is unavailable as a whole when disabled, and is left out of the submission like a native field', async () => {
    render(<form><SelectField aria-label="Stage" name="stageId" disabled defaultValue="s1" options={STAGES} /></form>);
    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    expect(trigger).toBeDisabled();
    await act(async () => { fireEvent.click(trigger); });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(formOf(trigger)).toEqual({});
  });

  it('returns to its starting choice when the form is reset', async () => {
    render(<form><SelectField aria-label="Stage" name="stageId" defaultValue="s1" options={STAGES} /><button type="reset">Reset</button></form>);
    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    await chooseOption(trigger, 's2');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset' })); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(fieldValue(trigger)).toBe('s1');
    expect(trigger).toHaveTextContent('Lead');
  });

  it('never reports a form reset as a choice, so a submit-on-change form is not sent back its old value', async () => {
    const changed = vi.fn();
    const submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
    HTMLFormElement.prototype.requestSubmit ??= function (this: HTMLFormElement) { this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };
    render(<form onSubmit={submitted}><SelectField aria-label="Stage" name="stageId" defaultValue="s1" options={STAGES} onValueChange={changed} submitOnChange /><button type="reset">Reset</button></form>);
    const trigger = screen.getByRole('combobox', { name: 'Stage' });
    await chooseOption(trigger, 's2');
    expect(submitted).toHaveBeenCalledTimes(1);
    // React resets a form after its action completes; that must not count as choosing.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reset' })); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(changed.mock.calls).toEqual([['s2']]);
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(fieldValue(trigger)).toBe('s1');
  });

  it('tells listeners on its form about a change, and can submit a one-control form', async () => {
    const heard = vi.fn();
    const submitted = vi.fn((event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); return Object.fromEntries(new FormData(event.currentTarget)); });
    render(<form onChange={heard} onSubmit={submitted}><SelectField aria-label="Stage" name="stageId" defaultValue="s1" options={STAGES} submitOnChange /></form>);
    HTMLFormElement.prototype.requestSubmit ??= function (this: HTMLFormElement) { this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); };
    await chooseOption(screen.getByRole('combobox', { name: 'Stage' }), 's2');
    await waitFor(() => expect(heard).toHaveBeenCalled());
    expect(submitted).toHaveBeenCalledTimes(1);
    expect(submitted.mock.results[0].value).toEqual({ stageId: 's2' });
  });
});

describe('SelectField (searchable Combobox)', () => {
  const MANY: SelectOption[] = Array.from({ length: 500 }, (_, index) => ({ value: `c${index}`, label: `Contact ${String(index).padStart(3, '0')}`, keywords: index === 321 ? 'harbour dental' : undefined }));

  it('becomes searchable for a long list, filtering by every word and by extra keywords', async () => {
    render(<form><FieldLabel htmlFor="who">Contact</FieldLabel><SelectField id="who" name="customerId" placeholder="Choose a contact" options={[{ value: '', label: 'No contact' }, ...MANY]} /></form>);
    expect(MANY.length).toBeGreaterThan(SEARCHABLE_FROM);
    const trigger = screen.getByRole('combobox', { name: 'Contact' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    await act(async () => { fireEvent.click(trigger); });
    const search = screen.getByRole('textbox', { name: 'Search Contact' });
    await waitFor(() => expect(search).toHaveFocus());
    expect(screen.getAllByRole('option')).toHaveLength(501);
    fireEvent.change(search, { target: { value: 'dental HARBOUR' } });
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['Contact 321']);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(fieldValue(trigger)).toBe('c321');
    expect(trigger).toHaveTextContent('Contact 321');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('says when nothing matches, moves a highlight with the arrows and never submits the form from the search field', async () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<form onSubmit={submit}><SelectField aria-label="Contact" name="customerId" searchable options={MANY.slice(0, 5)} /></form>);
    const trigger = screen.getByRole('combobox', { name: 'Contact' });
    await act(async () => { fireEvent.click(trigger); });
    const search = screen.getByRole('textbox', { name: 'Search Contact' });
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByRole('status')).toHaveTextContent('No matches');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const active = search.getAttribute('aria-activedescendant');
    expect(document.getElementById(active!)).toHaveTextContent('Contact 002');
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(fieldValue(trigger)).toBe('c2');
  });

  it('clears to its empty choice, opens by typing on the trigger, and closes with Escape back to the trigger', async () => {
    render(<SelectField aria-label="Contact" defaultValue="c1" searchable options={[{ value: '', label: 'No contact' }, ...MANY.slice(0, 5)]} />);
    const trigger = screen.getByRole('combobox', { name: 'Contact' });
    await chooseOption(trigger, '');
    expect(fieldValue(trigger)).toBe('');
    expect(trigger).toHaveTextContent('No contact');
    trigger.focus();
    await act(async () => { fireEvent.keyDown(trigger, { key: '4' }); });
    expect(screen.getByRole('textbox', { name: 'Search Contact' })).toHaveValue('4');
    await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search Contact' }), { key: 'Escape' }); });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('SuggestionField', () => {
  it('suggests while typing but keeps text that matches no suggestion exactly as typed', async () => {
    render(<form><FieldLabel htmlFor="industry">Industry</FieldLabel><SuggestionField id="industry" name="industry" suggestions={['Landscaping', 'Plumbing', 'Pool service']} /></form>);
    const input = screen.getByRole('combobox', { name: 'Industry' });
    fireEvent.change(input, { target: { value: 'pl' } });
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map(option => option.textContent)).toEqual(['Plumbing']);
    fireEvent.change(input, { target: { value: 'Beekeeping' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(formOf(input)).toEqual({ industry: 'Beekeeping' });
  });

  it('takes a suggestion with the arrow keys and Enter, and Escape closes the list without changing the text', async () => {
    const heard = vi.fn();
    render(<form onChange={heard}><SuggestionField aria-label="Industry" name="industry" suggestions={['Landscaping', 'Plumbing', 'Pool service']} /></form>);
    const input = screen.getByRole('combobox', { name: 'Industry' });
    fireEvent.change(input, { target: { value: 'p' } });
    await screen.findByRole('listbox');
    // "p" also finds Landscaping; the third step down is Pool service.
    for (let step = 0; step < 3; step++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)).toHaveTextContent('Pool service');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('Pool service');
    expect(heard).toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Pl' } });
    await screen.findByRole('listbox');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input).toHaveValue('Pl');
  });
});

describe('PeriodSelect', () => {
  it('goes to the chosen period’s own address at once, showing the choice while it loads', async () => {
    render(<PeriodSelect label="Communication date range" value="today" options={[{ value: 'today', label: 'Today', href: '/comms?when=today&queue=open&q=ann' }, { value: 'week', label: 'Last 7 days', href: '/comms?when=week&queue=open&q=ann' }]} />);
    const trigger = screen.getByRole('combobox', { name: 'Communication date range' });
    await chooseOption(trigger, 'Last 7 days');
    expect(push).toHaveBeenCalledWith('/comms?when=week&queue=open&q=ann', { scroll: false });
    expect(trigger).toHaveTextContent('Last 7 days');
  });
});
