'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createStatusAction, createWorkItemAction, type WorkActionState } from './actions';

const INITIAL: WorkActionState = { error: null };

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';

type Option = { id: string; label: string };

export function CreateWorkItemForm({
  organizationId,
  statuses,
  customers,
  locations,
  resources,
  definitions,
}: {
  organizationId: string;
  statuses: WorkItemStatus[];
  customers: Option[];
  locations: Option[];
  resources: Option[];
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

function OptionalSelect({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: Option[];
}) {
  return (
    <select name={name} defaultValue="" aria-label={label} className={INPUT_CLASS}>
      <option value="">{label} — none</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function CreateStatusForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createStatusAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />

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
