'use client';

import { useActionState, useId } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import {
  assignResourceCapabilityAction,
  removeResourceCapabilityAction,
  type ResourceEditState,
} from '@/app/organizations/[organizationId]/resources/actions';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: ResourceEditState = { error: null };

/**
 * What this resource can do. Each held capability is a chip with its own remove button, named for
 * what it removes; giving one is a choice from the business's vocabulary or, for somebody who may
 * configure it, a new word. Read-only (plain chips) for a caller who may not change the resource —
 * the database refuses them either way.
 */
export function ResourceCapabilitiesControl({
  organizationId,
  resourceId,
  resourceName,
  held,
  available,
  mayChange,
  mayAddWord,
}: {
  organizationId: string;
  resourceId: string;
  resourceName: string;
  held: ResourceCapability[];
  /** Vocabulary this resource does not hold yet, archived excluded. */
  available: ResourceCapability[];
  mayChange: boolean;
  mayAddWord: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {held.length === 0 ? (
        <Hint>None. Capabilities are optional.</Hint>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {held.map((capability) => (
            <li key={capability.id}>
              {mayChange ? (
                <HeldCapability
                  organizationId={organizationId}
                  resourceId={resourceId}
                  resourceName={resourceName}
                  capability={capability}
                />
              ) : (
                <Badge>{capability.name}</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
      {mayChange && (available.length > 0 || mayAddWord) ? (
        <AddCapability
          organizationId={organizationId}
          resourceId={resourceId}
          available={available}
          mayAddWord={mayAddWord}
        />
      ) : null}
    </div>
  );
}

function HeldCapability({
  organizationId,
  resourceId,
  resourceName,
  capability,
}: {
  organizationId: string;
  resourceId: string;
  resourceName: string;
  capability: ResourceCapability;
}) {
  const [state, action, pending] = useActionState(removeResourceCapabilityAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <input type="hidden" name="capabilityId" value={capability.id} />
      <Badge className="gap-1 pr-1">
        {capability.name}
        {capability.archived ? ' (archived)' : ''}
        <button
          type="submit"
          disabled={pending}
          aria-label={`Remove ${capability.name} from ${resourceName}`}
          className="rounded p-0.5 hover:bg-hover"
        >
          <X aria-hidden className="size-3" />
        </button>
      </Badge>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

function AddCapability({
  organizationId,
  resourceId,
  available,
  mayAddWord,
}: {
  organizationId: string;
  resourceId: string;
  available: ResourceCapability[];
  mayAddWord: boolean;
}) {
  const [state, action, pending] = useActionState(assignResourceCapabilityAction, INITIAL);
  const selectId = useId();
  const newId = useId();

  return (
    <form action={action} className="flex flex-col gap-2 sm:max-w-md">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      {available.length > 0 ? (
        <>
          <label htmlFor={selectId} className="text-sm text-muted">
            Add a capability
          </label>
          <SelectField id={selectId} name="capabilityId" size="small" defaultValue="" options={[{ value: '', label: 'Choose…' }, ...available.map((capability) => ({ value: capability.id, label: capability.name }))]} />
        </>
      ) : null}
      {mayAddWord ? (
        <>
          <label htmlFor={newId} className="text-sm text-muted">
            {available.length > 0 ? 'or a new one' : 'Add a capability'}
          </label>
          <TextInput id={newId} name="newCapability" type="text" maxLength={64} size="small" placeholder="Tire service" />
        </>
      ) : null}
      <Button type="submit" disabled={pending} tone="secondary" size="small" className="w-fit">
        {pending ? 'Adding…' : 'Add'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
