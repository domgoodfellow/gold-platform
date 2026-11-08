'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import {
  RESOURCE_CLASSES,
  RESOURCE_CLASS_LABELS,
  type ResourceClass,
} from '@/lib/domain/resources/resource-class';
import type { ResourceRequirement } from '@/lib/domain/work-items/requirements';
import {
  createRequirementAction,
  deleteRequirementAction,
  updateRequirementAction,
  type WorkConfigActionState,
} from './actions';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: WorkConfigActionState = { error: null };

/**
 * What this kind of work needs, as the business reads it: "2 × Person · Tire service". A minimum
 * need, not a list of who may be assigned — a job can carry more, and can be scheduled with fewer.
 * Compact rows rather than cards: each requirement is one line to scan and one form to change.
 */
export function ResourceRequirementsEditor({
  organizationId,
  typeId,
  typeName,
  requirements,
  capabilities,
  mayConfigure,
}: {
  organizationId: string;
  typeId: string;
  typeName: string;
  requirements: ResourceRequirement[];
  /** The active vocabulary. A requirement's own archived capabilities are shown alongside, truthfully. */
  capabilities: ResourceCapability[];
  mayConfigure: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Hint>
        {requirements.length === 0
          ? `${typeName} does not say what it needs yet. Optional: say how many of which kind of resource a job needs, and which skills they must have.`
          : `A ${typeName} job needs at least this much. More resources can always be added, and a job can be scheduled before it has them all.`}
      </Hint>

      <ul className="flex flex-col gap-3">
        {requirements.map((requirement) => (
          <li key={requirement.id} className="border-b border-border pb-3 last:border-b-0">
            <RequirementForm
              organizationId={organizationId}
              typeId={typeId}
              requirement={requirement}
              capabilities={capabilities}
              mayConfigure={mayConfigure}
            />
          </li>
        ))}
      </ul>

      {mayConfigure ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Add a requirement</span>
          <RequirementForm organizationId={organizationId} typeId={typeId} capabilities={capabilities} mayConfigure />
        </div>
      ) : null}
    </div>
  );
}

function RequirementForm({
  organizationId,
  typeId,
  requirement,
  capabilities,
  mayConfigure,
}: {
  organizationId: string;
  typeId: string;
  requirement?: ResourceRequirement;
  capabilities: ResourceCapability[];
  mayConfigure: boolean;
}) {
  const [saveState, save, saving] = useActionState(requirement ? updateRequirementAction : createRequirementAction, INITIAL);
  const [removeState, remove, removing] = useActionState(deleteRequirementAction, INITIAL);
  const quantityId = useId();
  const classId = useId();
  const held = new Set(requirement?.capabilities.map((capability) => capability.id));

  // The active vocabulary, plus whatever this requirement already names even if archived since:
  // dropping it from view would quietly change what the form says the work needs.
  const options = [
    ...capabilities,
    ...(requirement?.capabilities.filter((capability) => !capabilities.some((active) => active.id === capability.id)) ?? []),
  ];

  const label = requirement
    ? `${requirement.quantity} × ${RESOURCE_CLASS_LABELS[requirement.resourceClass]}`
    : 'new requirement';

  return (
    <div className="flex flex-col gap-2">
      <form action={save} className="flex flex-col gap-2" aria-label={`Requirement: ${label}`}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="typeId" value={typeId} />
        {requirement ? <input type="hidden" name="requirementId" value={requirement.id} /> : null}

        <div className="flex flex-wrap items-end gap-3">
          <label htmlFor={quantityId} className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Number needed</span>
            <TextInput
              id={quantityId}
              name="quantity"
              type="number"
              required
              min={1}
              max={50}
              step={1}
              defaultValue={requirement?.quantity ?? 1}
              disabled={!mayConfigure}
              size="small"
              className="w-20"
            />
          </label>
          <label htmlFor={classId} className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Kind of resource</span>
            <SelectField id={classId} name="resourceClass" required defaultValue={requirement?.resourceClass ?? ''} disabled={!mayConfigure} size="small" options={[...(requirement ? [] : [{ value: '', label: 'Choose a type', disabled: true }]), ...RESOURCE_CLASSES.map((value: ResourceClass) => ({ value: value, label: RESOURCE_CLASS_LABELS[value] }))]} />
          </label>
        </div>

        {options.length > 0 ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm text-muted">Must have all of</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {options.map((capability) => (
                <label key={capability.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="capabilityIds"
                    value={capability.id}
                    defaultChecked={held.has(capability.id)}
                    disabled={!mayConfigure}
                  />
                  {capability.name}
                  {capability.archived ? ' (archived)' : ''}
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <Hint>No skills yet. A kind of resource is enough, or add skills in Resources settings.</Hint>
        )}

        {mayConfigure ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={saving} tone="secondary" size="small">
              {saving ? 'Saving…' : requirement ? 'Save requirement' : 'Add requirement'}
            </Button>
          </div>
        ) : null}
        <ErrorText role="alert">{saveState.error}</ErrorText>
      </form>

      {requirement && mayConfigure ? (
        <form action={remove}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="requirementId" value={requirement.id} />
          <Button type="submit" disabled={removing} tone="secondary" size="tiny" aria-label={`Remove requirement ${label}`}>
            Remove
          </Button>
          <ErrorText role="alert">{removeState.error}</ErrorText>
        </form>
      ) : null}
    </div>
  );
}
