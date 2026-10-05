'use client';

import { ErrorText, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button, ButtonLink } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { useActionState } from 'react';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import type { TypeBooking } from '@/lib/domain/work-items/types';
import type { TypeChecklistItem } from '@/lib/domain/work-items/checklists';
import {
  addTypeChecklistItemAction,
  createStatusAction,
  createTransitionAction,
  createTypeAction,
  removeTypeChecklistItemAction,
  renameTypeAction,
  setTypeBookableAction,
  setTypeBookingIntakeAction,
  setTypeSchedulableAction,
  updateStatusAction,
  type WorkConfigActionState,
} from './actions';

const INITIAL: WorkConfigActionState = { error: null };

export function CreateStatusForm({
  organizationId,
  typeId,
}: {
  organizationId: string;
  typeId: string;
}) {
  const [state, formAction, pending] = useActionState(createStatusAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          placeholder="Status name, e.g. Awaiting parts"
          aria-label="Status name"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Adding…' : 'Add status'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function CreateTypeForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createTypeAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <TextInput
        name="name"
        type="text"
        required
        maxLength={64}
        placeholder="Type name, e.g. Installation"
        aria-label="Type name"
        className="w-full"
      />

      {/* Neither answer is preselected: whether a business schedules this work is its to say, and a
          default would be the platform answering for it. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Scheduling</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="schedulable" value="yes" required className="mt-1" />
          <span>
            Scheduled
            <span className="block text-muted">This work happens at a time and can appear in Schedule.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="schedulable" value="no" required className="mt-1" />
          <span>
            Not scheduled
            <span className="block text-muted">This work has no set time, like a sales opportunity.</span>
          </span>
        </label>
      </fieldset>

      <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
        {pending ? 'Adding…' : 'Add type'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * Whether this kind of work is scheduled. Lives with the rest of what a type *is* — Schedule
 * configuration owns how scheduling operates, never whether this work does it.
 */
export function SchedulingTypeForm({
  organizationId,
  typeId,
  typeName,
  schedulable,
  published,
  disabled,
}: {
  organizationId: string;
  typeId: string;
  typeName: string;
  schedulable: boolean;
  /** Whether the type is on the public booking page, which needs it to stay scheduled. */
  published: boolean;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setTypeSchedulableAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="schedulable"
          value="1"
          defaultChecked={schedulable}
          disabled={disabled}
          aria-label={`${typeName} is scheduled`}
          className="mt-1"
        />
        <span>
          This work is scheduled
          <span className="block text-muted">
            {typeName} happens at a time and can appear in Schedule.
            {published ? ' It is on the public booking page, which needs it to stay scheduled.' : ''}
          </span>
        </span>
      </label>
      <Button type="submit" disabled={pending || disabled} tone="secondary" className="w-fit">
        {pending ? 'Saving…' : 'Save'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function CreateTransitionForm({
  organizationId,
  typeId,
  statuses,
}: {
  organizationId: string;
  typeId: string;
  statuses: WorkItemStatus[];
}) {
  const [state, formAction, pending] = useActionState(createTransitionAction, INITIAL);

  if (statuses.length < 2) {
    return (
      <Hint className="mt-2">
        Add a second status before wiring moves between them.
      </Hint>
    );
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SelectInput name="fromStatusId" aria-label="Move from" className="flex-1">
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </SelectInput>
        <span aria-hidden className="text-subtle">
          →
        </span>
        <SelectInput name="toStatusId" aria-label="Move to" className="flex-1">
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </SelectInput>
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Allowing…' : 'Allow move'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function RenameTypeForm({
  organizationId,
  typeId,
  name,
}: {
  organizationId: string;
  typeId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(renameTypeAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          defaultValue={name}
          aria-label="Type name"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Renaming…' : 'Rename'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/** Rename a board column, or move it. Renaming moves no work — a job references its status by id. */
export function EditStatusForm({
  organizationId,
  status,
}: {
  organizationId: string;
  status: WorkItemStatus;
}) {
  const [state, formAction, pending] = useActionState(updateStatusAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 py-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="statusId" value={status.id} />

      <TextInput
        name="name"
        type="text"
        required
        maxLength={64}
        defaultValue={status.name}
        aria-label={`Name of status ${status.name}`}
        size="small"
      />
      <TextInput
        name="position"
        type="number"
        required
        min={0}
        step={1}
        defaultValue={status.position}
        aria-label={`Position of status ${status.name}`}
        size="small"
        className="w-20"
      />
      {/* The two questions the platform asks about a status, and both are the tenant's to
          answer. Neither is `is_terminal`: that would be the platform deciding what a word
          means, and these ask about two different consequences of it. "Cancelled" frees the
          van and is not finished work; "Awaiting parts" holds the van and is not finished
          work either — one flag could not have said both, which is why M4 refused one. */}
      <label className="flex items-center gap-1.5 text-xs opacity-80">
        <input
          name="releasesResource"
          type="checkbox"
          value="1"
          defaultChecked={status.releasesResource}
          aria-label={`Work in ${status.name} releases its resource`}
        />
        Frees the resource
      </label>
      {/* Read afterwards against the event log rather than at the moment work moves, so
          answering this later counts history correctly rather than only what happens next. */}
      <label className="flex items-center gap-1.5 text-xs opacity-80">
        <input
          name="marksComplete"
          type="checkbox"
          value="1"
          defaultChecked={status.marksComplete}
          aria-label={`Moving work into ${status.name} means it was finished`}
        />
        Means finished
      </label>
      <Button type="submit" disabled={pending} tone="secondary" size="tiny">
        Save
      </Button>

      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function AddTypeChecklistItemForm({
  organizationId,
  typeId,
}: {
  organizationId: string;
  typeId: string;
}) {
  const [state, formAction, pending] = useActionState(addTypeChecklistItemAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="label"
          type="text"
          required
          maxLength={200}
          placeholder="A step every job of this kind involves"
          aria-label="Template step"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Adding…' : 'Add step'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function TypeChecklistItemRow({
  organizationId,
  item,
}: {
  organizationId: string;
  item: TypeChecklistItem;
}) {
  const [state, formAction, pending] = useActionState(removeTypeChecklistItemAction, INITIAL);
  const formId = `remove-checklist-item-${item.id}`;

  return (
    <form id={formId} action={formAction} className="flex items-center gap-3 py-1 text-sm">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={item.id} />

      <span className="flex-1">{item.label}</span>
      <ConfirmSubmit
        formId={formId}
        label="Remove"
        confirmLabel="Remove item"
        description={`Remove "${item.label}" from this checklist? Work items already using it keep their history.`}
        tone="secondary"
        size="tiny"
        pending={pending}
      />

      {state.error ? (
        <span role="alert" className="text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/**
 * Publish this kind of work to the public booking page, or withdraw it.
 *
 * Two things it says out loud rather than hiding. A type with **no statuses** cannot be
 * published at all, because a booking has to arrive somewhere — so the form explains that
 * instead of offering an empty dropdown. And the price is genuinely optional: a business may
 * take bookings without publishing what it charges, and saying nothing is different from saying
 * zero, which is why there is no "0" in the list.
 */
export function PublishTypeForm({
  organizationId,
  typeId,
  typeName,
  statuses,
  prices,
  booking,
  intakeForms,
  schedulable,
  disabled,
}: {
  organizationId: string;
  typeId: string;
  typeName: string;
  schedulable: boolean;
  statuses: WorkItemStatus[];
  prices: PriceBookItem[];
  booking: TypeBooking | null;
  intakeForms: Array<{ id: string; name: string }>;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setTypeBookableAction, INITIAL);

  if (!schedulable) {
    return (
      <Hint className="mt-4">
        {typeName} is not scheduled, so it cannot be booked. Turn scheduling on for it above first.
      </Hint>
    );
  }

  if (statuses.length === 0) {
    return (
      <Hint className="mt-4">
        {typeName} has no stages yet, so a booking would have nowhere to arrive. Add one above
        and this becomes publishable.
      </Hint>
    );
  }

  return (
    <>
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />

      <Hint>
        {booking
          ? `${typeName} is on the public page. A booking arrives in the stage below.`
          : `${typeName} is not on the public page.`}
      </Hint>

      <label className="text-sm">
        A booking arrives in
        <SelectInput
          name="statusId"
          required
          defaultValue={booking?.statusId ?? ''}
          disabled={disabled}
          className="flex-1 mt-1 block w-full"
        >
          <option value="">Choose a stage</option>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </SelectInput>
      </label>

      <label className="text-sm">
        and takes, in minutes
        <TextInput
          name="durationMinutes"
          type="number"
          min={5}
          max={1440}
          required
          defaultValue={booking?.durationMinutes ?? ''}
          disabled={disabled}
          className="flex-1 mt-1 block w-full"
        />
      </label>

      <label className="text-sm">
        Shown at this price, if you publish one
        <SelectInput
          name="priceItemId"
          defaultValue={booking?.priceItemId ?? ''}
          disabled={disabled}
          className="flex-1 mt-1 block w-full"
        >
          <option value="">Do not show a price</option>
          {prices.map((price) => (
            <option key={price.id} value={price.id}>
              {price.name}
            </option>
          ))}
        </SelectInput>
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || pending} tone="secondary" className="w-fit">
          {pending ? 'Saving…' : booking ? 'Update what is published' : 'Publish it'}
        </Button>

        {/* Withdrawing is the same call with no status, so it is a second submit button on one
            form rather than a second form: there is no `bookable` flag to clear. */}
        {booking ? (
          <Button
            type="submit"
            name="withdraw"
            value="yes"
            formNoValidate
            disabled={disabled || pending}
            tone="secondary"
            className="w-fit"
          >
            Take it off the page
          </Button>
        ) : null}
      </div>

      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
    {booking ? <BookingIntakeForm organizationId={organizationId} typeId={typeId} current={booking.intakeFormId} forms={intakeForms} disabled={disabled} /> : null}
    </>
  );
}

/**
 * The questions a public booking asks, chosen from the business's own forms. Booking holds only the
 * choice; the questions, their revisions and the answers stay Forms'. Editing is Studio's job, so
 * this links there rather than growing a second editor.
 */
function BookingIntakeForm({
  organizationId,
  typeId,
  current,
  forms,
  disabled,
}: {
  organizationId: string;
  typeId: string;
  current: string | null;
  forms: Array<{ id: string; name: string }>;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setTypeBookingIntakeAction, INITIAL);
  const studio = `/organizations/${organizationId}/studio/forms`;

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />
      <label className="text-sm">
        Additional questions when somebody books
        <SelectInput name="formId" defaultValue={current ?? ''} disabled={disabled} className="flex-1 mt-1 block w-full">
          <option value="">No additional questions</option>
          {forms.map((form) => (
            <option key={form.id} value={form.id}>
              {form.name}
            </option>
          ))}
        </SelectInput>
      </label>
      <Hint>
        {forms.length === 0
          ? 'Publish a form in Studio to ask questions at booking.'
          : 'The answers are kept with the booking. Name, email and phone are always asked.'}
      </Hint>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled || pending} tone="secondary" className="w-fit">
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {current ? (
          <ButtonLink tone="text" href={`${studio}/${current}`}>
            Edit the form
          </ButtonLink>
        ) : null}
        <ButtonLink tone="text" href={studio}>
          Open Forms
        </ButtonLink>
      </div>
      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
