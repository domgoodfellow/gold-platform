'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import {
  changeStatusAction,
  scheduleWorkItemAction,
  setWorkItemResourcesAction,
  type WorkActionState,
} from '@/app/organizations/[organizationId]/work/actions';
import { checkFeasibilityAction, type FeasibilityState } from '@/app/organizations/[organizationId]/work/feasibility-actions';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import type { SelectOption } from '@/components/controls/optional-select';
import { ResourceChecklist } from '@/components/controls/resource-checklist';
import type { ResourceNeedsView } from '@/lib/domain/work-items/requirements';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { FeasibilityPanel } from './feasibility-panel';
import type { Window } from '@/lib/domain/scheduling/window';

const CHECK_INITIAL: FeasibilityState = { error: null };

/** What the picker needs from a type's requirements: its groups, as plain props. */
function needsProps(needs: ResourceNeedsView | null | undefined) {
  if (!needs || needs.groups.length === 0) return {};
  return {
    groups: needs.groups.map((group) => ({
      key: group.requirementId,
      title: group.title,
      hint: `${group.quantity} required`,
      resourceIds: group.resourceIds,
    })),
    additionalIds: needs.additionalIds,
  };
}

const INITIAL: WorkActionState = { error: null };

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

  if (moves.length === 0) return null;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2" aria-label="Change stage">
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
          size="small"
        >
          Move to {move.name}
        </Button>
      ))}
      <FormError className="w-full">{state.error}</FormError>
    </form>
  );
}

export function ScheduleWorkItemForm({
  organizationId,
  workItemId,
  resources,
  assigned,
  needs,
  scheduled,
  window,
  timezone,
  onSaved,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
  /** Ids of the resources on the job now — what the boxes start ticked as. */
  assigned: string[];
  /** What this kind of work needs, with the resources eligible for each — absent when it says nothing. */
  needs?: ResourceNeedsView | null;
  scheduled: boolean;
  window?: Window | null;
  timezone?: string;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(scheduleWorkItemAction, INITIAL);
  // Asking *would this work?* is a second action on the same form: it reads the same fields, writes
  // nothing, and leaves the operator to decide.
  const [check, checkAction, checking] = useActionState(checkFeasibilityAction, CHECK_INITIAL);
  const [selected, setSelected] = useState<readonly string[]>(assigned);
  const [version, setVersion] = useState(0);
  const [inputVersion, setInputVersion] = useState(0);
  const [checkedVersion, setCheckedVersion] = useState(-1);
  const { ref: formRef, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const cancel = useGuardedDialogClose();
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending);
  useEffect(() => { if (state.success) onSaved?.(); }, [state.success, onSaved]);
  const [, startTransition] = useTransition();
  const localTime = (instant: string | undefined) => {
    if (!instant || !timezone) return undefined;
    const parts = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(instant));
    return parts.replace(' ', 'T');
  };

  // Dispatched by hand, not as the form's action: a form action resets the form when it finishes,
  // which would wipe the times and ticks the operator is in the middle of choosing.
  const runCheck = () => {
    if (!formRef.current) return;
    const data = new FormData(formRef.current);
    setCheckedVersion(inputVersion);
    startTransition(() => checkAction(data));
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} onChange={() => { onChange(); setInputVersion(v => v + 1); }} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`schedule-start-${workItemId}`} label="Starts">
          {(field) => <TextInput {...field} name="startsAt" type="datetime-local" defaultValue={localTime(window?.startsAt)} />}
        </FormField>
        <FormField id={`schedule-end-${workItemId}`} label="Ends">
          {(field) => <TextInput {...field} name="endsAt" type="datetime-local" defaultValue={localTime(window?.endsAt)} />}
        </FormField>
      </div>
      {/* Re-keyed when a suggestion is applied, so the boxes start from it; otherwise they are the operator's own. */}
      <div key={version}>
        <ResourceChecklist
          legend="Resources"
          options={resources}
          selected={selected}
          hint="Everyone ticked takes part for this whole time. Tick none for work nobody is on yet."
          {...needsProps(needs)}
        />
      </div>
      {check.error && checkedVersion === inputVersion ? (
        <p role="alert" className="text-sm text-danger">
          {check.error}
        </p>
      ) : null}
      {check.view && checkedVersion === inputVersion ? (
        <FeasibilityPanel
          view={check.view}
          onUseSuggested={(ids) => {
            setSelected(ids);
            setInputVersion(v => v + 1);
            setVersion((current) => current + 1);
            onChange();
          }}
        />
      ) : null}
      <FormActions className={onSaved ? 'sticky bottom-0 z-10 -mx-1 bg-surface px-1 py-2' : undefined}>
        <Button type="button" onClick={runCheck} disabled={pending || checking} tone="secondary" size="small">
          {checking ? 'Checking…' : 'Check this time'}
        </Button>
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Scheduling…' : scheduled ? 'Reschedule' : 'Schedule'}
        </Button>
        {scheduled ? (
          <Button
            type="submit"
            name="clear"
            value="1"
            disabled={pending}
            tone="secondary"
            size="small"
          >
            Clear schedule
          </Button>
        ) : null}
        {onSaved ? <Button type="button" tone="secondary" size="small" disabled={pending} onClick={cancel}>Cancel</Button> : null}
      </FormActions>
      <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
      {state.success ? <p role="status" className="text-xs text-success">{state.success}</p> : null}
    </form>
  );
}

/**
 * Who is on this job, changed on its own — the time stays exactly where it is. If any resource is
 * busy for the job's time the whole change is refused and the job keeps who it had.
 */
export function AssignResourcesForm({
  organizationId,
  workItemId,
  resources,
  assigned,
  needs,
  onSaved,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
  assigned: string[];
  needs?: ResourceNeedsView | null;
  onSaved?: () => void;
}) {
  const [state, formAction, pending] = useActionState(setWorkItemResourcesAction, INITIAL);
  const { ref, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const cancel = useGuardedDialogClose();
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending);
  useEffect(() => { if (state.success) onSaved?.(); }, [state.success, onSaved]);

  return (
    <form ref={ref} onSubmit={onSubmit} onChange={onChange} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <ResourceChecklist legend="Assigned to" options={resources} selected={assigned} {...needsProps(needs)} />
      <FormActions className={onSaved ? 'sticky bottom-0 z-10 -mx-1 bg-surface px-1 py-2' : undefined}>
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Saving…' : 'Save resources'}
        </Button>
        {onSaved ? <Button type="button" tone="secondary" size="small" disabled={pending} onClick={cancel}>Cancel</Button> : null}
      </FormActions>
      <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
      {state.success ? <p role="status" className="text-xs text-success">{state.success}</p> : null}
    </form>
  );
}

/**
 * Puts the suggested resources on the job — one click, but only ever the operator's. The assignment
 * command is the same one "Who is on this" uses, so everything it refuses (a resource that stopped
 * working, one that was taken since) is refused here in the same words.
 */
export function AssignSuggestedForm({
  organizationId,
  workItemId,
  resourceIds,
}: {
  organizationId: string;
  workItemId: string;
  resourceIds: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(setWorkItemResourcesAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      {resourceIds.map((id) => (
        <input key={id} type="hidden" name="resourceIds" value={id} />
      ))}
      <div>
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Assigning…' : 'Assign suggested resources'}
        </Button>
      </div>
      <FormError>{state.error}</FormError>
      {state.success ? <p role="status" className="text-xs text-success">{state.success}</p> : null}
    </form>
  );
}
