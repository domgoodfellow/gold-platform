'use client';

import { ErrorText, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-fields/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  changeStatusAction,
  createWorkItemAction,
  scheduleWorkItemAction,
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
  assetsEnabled,
  definitions,
}: {
  organizationId: string;
  statuses: WorkItemStatus[];
  customers: SelectOption[];
  locations: SelectOption[];
  resources: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
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
          compressor" names an asset; "Sam drives there" names a resource. Gated on the Assets
          module the same way Quote/Invoice/Margin are gated on billing (D25): a business that
          switched Assets off should not see an asset picker on a job, empty or not. */}
      {assetsEnabled ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <OptionalSelect name="assetId" label="About" options={assets} />
        </div>
      ) : null}

      <CustomFieldInputs definitions={definitions} />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add work item'}
      </Button>

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
