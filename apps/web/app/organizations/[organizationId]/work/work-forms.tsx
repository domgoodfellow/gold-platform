'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-fields/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { TypeBooking } from '@/lib/domain/work-items/types';
import type { TypeChecklistItem } from '@/lib/domain/work-items/checklists';
import {
  addTypeChecklistItemAction,
  changeStatusAction,
  createStatusAction,
  createTransitionAction,
  createTypeAction,
  createWorkItemAction,
  removeTypeChecklistItemAction,
  renameTypeAction,
  scheduleWorkItemAction,
  setTypeBookableAction,
  updateStatusAction,
  type WorkActionState,
} from './actions';

const INITIAL: WorkActionState = { error: null };

export function CreateWorkItemForm({
  organizationId,
  statuses,
  customers,
  locations,
  resources,
  assets,
  definitions,
}: {
  organizationId: string;
  statuses: WorkItemStatus[];
  customers: SelectOption[];
  locations: SelectOption[];
  resources: SelectOption[];
  assets: SelectOption[];
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createWorkItemAction, INITIAL);

  if (statuses.length === 0) {
    return (
      <Hint className="mt-8">
        Add a status below before recording work. A work item without a state is not on the
        board.
      </Hint>
    );
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>New work item</SectionHeading>

      {/* The type is not submitted. It follows from the status, and the statuses offered here
          are already this type's — so a form that also carried the type would be carrying a
          value that could contradict the one beside it. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="title"
          type="text"
          required
          maxLength={300}
          placeholder="What needs doing"
          aria-label="Title"
          className="flex-1"
        />
        <SelectInput name="statusId" aria-label="Status" className="flex-1">
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </SelectInput>
      </div>

      {/* All three optional: internal work has no customer, a workshop job has no site, and
          unassigned is the normal state of a job that has just arrived. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <OptionalSelect name="customerId" label="Customer" options={customers} />
        <OptionalSelect name="locationId" label="Location" options={locations} />
        <OptionalSelect name="resourceId" label="Assigned to" options={resources} />
      </div>

      {/* What the work is about, as opposed to what it is done with. "Service the
          compressor" names an asset; "Sam drives there" names a resource. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <OptionalSelect name="assetId" label="About" options={assets} />
      </div>

      <CustomFieldInputs definitions={definitions} />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add work item'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

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
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          placeholder="Type name, e.g. Installation"
          aria-label="Type name"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Adding…' : 'Add type'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

/**
 * The moves this work item may make, as buttons.
 *
 * Rendering only the legal ones is a courtesy, not the guard. `app.check_status_transition`
 * refuses an unconfigured move whatever arrives in the form, and `work_items_update` refuses
 * a caller without the capability — so a forged status id gets the same answer as a clicked
 * button (constraints.md: hiding a UI element is not authorization).
 */
export function MoveWorkItemForm({
  organizationId,
  workItemId,
  moves,
}: {
  organizationId: string;
  workItemId: string;
  moves: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(changeStatusAction, INITIAL);

  if (moves.length === 0) {
    return null;
  }

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      {moves.map((move) => (
        <Button
          key={move.id}
          type="submit"
          name="toStatusId"
          value={move.id}
          disabled={pending}
          tone="secondary"
          size="tiny"
        >
          → {move.name}
        </Button>
      ))}

      <ErrorText role="alert" className="w-full">{state.error}</ErrorText>
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

/**
 * Commit a work item to a resource and a window.
 *
 * The times are entered in the tenant's zone and submitted as wall-clock strings; the server
 * turns them into instants. Nothing here asks whether the slot is free — availability is
 * advisory by construction (I6), and the exclusion constraint is what actually decides.
 */
export function ScheduleWorkItemForm({
  organizationId,
  workItemId,
  resources,
  scheduled,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
  scheduled: boolean;
}) {
  const [state, formAction, pending] = useActionState(scheduleWorkItemAction, INITIAL);

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          name="startsAt"
          type="datetime-local"
          aria-label="Starts at"
          className="px-2 py-1 text-xs"
        />
        <TextInput
          name="endsAt"
          type="datetime-local"
          aria-label="Ends at"
          className="px-2 py-1 text-xs"
        />
        <OptionalSelect name="resourceId" label="Assign to" options={resources} />
        <Button type="submit" disabled={pending} tone="secondary" size="tiny">
          {pending ? 'Scheduling…' : 'Schedule'}
        </Button>
        {scheduled ? (
          <Button
            type="submit"
            name="clear"
            value="1"
            disabled={pending}
            tone="secondary"
            size="tiny"
          >
            Clear
          </Button>
        ) : null}
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

  return (
    <form action={formAction} className="flex items-center gap-3 py-1 text-sm">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={item.id} />

      <span className="flex-1">{item.label}</span>
      <Button type="submit" disabled={pending} tone="secondary" size="tiny">
        Remove
      </Button>

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
 * **The screen `market.md` lists under what blocks the first customer.** Until this existed,
 * `setTypeBookable` was reachable only from a database client, so the whole public booking flow
 * was unreachable by hand on a platform whose milestone criterion is that nobody at the business
 * has been given database access.
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
  disabled,
}: {
  organizationId: string;
  typeId: string;
  typeName: string;
  statuses: WorkItemStatus[];
  prices: PriceBookItem[];
  booking: TypeBooking | null;
  disabled: boolean;
}) {
  const [state, formAction, pending] = useActionState(setTypeBookableAction, INITIAL);

  if (statuses.length === 0) {
    return (
      <Hint className="mt-4">
        {typeName} has no stages yet, so a booking would have nowhere to arrive. Add one above
        and this becomes publishable.
      </Hint>
    );
  }

  return (
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
  );
}
