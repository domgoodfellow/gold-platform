'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import { OptionalSelect, type SelectOption } from '@/components/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
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
  updateStatusAction,
  type WorkActionState,
} from './actions';

const INITIAL: WorkActionState = { error: null };

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';

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
      <p className="mt-8 text-sm opacity-70">
        Add a status below before recording work. A work item without a state is not on the
        board.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">New work item</h2>

      {/* The type is not submitted. It follows from the status, and the statuses offered here
          are already this type's — so a form that also carried the type would be carrying a
          value that could contradict the one beside it. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="title"
          type="text"
          required
          maxLength={300}
          placeholder="What needs doing"
          aria-label="Title"
          className={INPUT_CLASS}
        />
        <select name="statusId" aria-label="Status" className={INPUT_CLASS}>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
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

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add work item'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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
        <input
          name="name"
          type="text"
          required
          maxLength={64}
          placeholder="Status name, e.g. Awaiting parts"
          aria-label="Status name"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Adding…' : 'Add status'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function CreateTypeForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createTypeAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          type="text"
          required
          maxLength={64}
          placeholder="Type name, e.g. Installation"
          aria-label="Type name"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Adding…' : 'Add type'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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
        <button
          key={move.id}
          type="submit"
          name="toStatusId"
          value={move.id}
          disabled={pending}
          className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
        >
          → {move.name}
        </button>
      ))}

      {state.error ? (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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
      <p className="mt-2 text-sm opacity-70">
        Add a second status before wiring moves between them.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="typeId" value={typeId} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select name="fromStatusId" aria-label="Move from" className={INPUT_CLASS}>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
        <span aria-hidden className="opacity-60">
          →
        </span>
        <select name="toStatusId" aria-label="Move to" className={INPUT_CLASS}>
          {statuses.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Allowing…' : 'Allow move'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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
        <input
          name="startsAt"
          type="datetime-local"
          aria-label="Starts at"
          className="rounded border border-black/15 px-2 py-1 text-xs dark:border-white/20"
        />
        <input
          name="endsAt"
          type="datetime-local"
          aria-label="Ends at"
          className="rounded border border-black/15 px-2 py-1 text-xs dark:border-white/20"
        />
        <OptionalSelect name="resourceId" label="Assign to" options={resources} />
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Scheduling…' : 'Schedule'}
        </button>
        {scheduled ? (
          <button
            type="submit"
            name="clear"
            value="1"
            disabled={pending}
            className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
          >
            Clear
          </button>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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
        <input
          name="name"
          type="text"
          required
          maxLength={64}
          defaultValue={name}
          aria-label="Type name"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Renaming…' : 'Rename'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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

      <input
        name="name"
        type="text"
        required
        maxLength={64}
        defaultValue={status.name}
        aria-label={`Name of status ${status.name}`}
        className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
      />
      <input
        name="position"
        type="number"
        required
        min={0}
        step={1}
        defaultValue={status.position}
        aria-label={`Position of status ${status.name}`}
        className="w-20 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
      >
        Save
      </button>

      {state.error ? (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
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
        <input
          name="label"
          type="text"
          required
          maxLength={200}
          placeholder="A step every job of this kind involves"
          aria-label="Template step"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Adding…' : 'Add step'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
      >
        Remove
      </button>

      {state.error ? (
        <span role="alert" className="text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
