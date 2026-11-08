'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import {
  archiveCapabilityAction,
  createCapabilityAction,
  renameCapabilityAction,
  type ResourceEditState,
} from '@/app/organizations/[organizationId]/resources/actions';

const INITIAL: ResourceEditState = { error: null };

/**
 * The words a business uses for what its resources can do. Renaming keeps every assignment (they
 * point at the id); archiving stops a word being given again without taking it off the resources
 * that hold it. There is no delete, on purpose.
 */
export function CapabilityVocabulary({
  organizationId,
  capabilities,
  mayConfigure,
  role,
}: {
  organizationId: string;
  capabilities: ResourceCapability[];
  mayConfigure: boolean;
  role: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Hint>
        What a business can say a resource does — optional, and entirely in your own words.
      </Hint>
      {capabilities.length === 0 ? <Hint>None yet.</Hint> : null}
      <ul className="flex flex-col gap-2">
        {capabilities.map((capability) => (
          <li key={capability.id}>
            <CapabilityRow organizationId={organizationId} capability={capability} mayConfigure={mayConfigure} />
          </li>
        ))}
      </ul>
      {mayConfigure ? (
        <AddCapabilityForm organizationId={organizationId} />
      ) : (
        <Hint>Your role, {role}, cannot change skills.</Hint>
      )}
    </div>
  );
}

function CapabilityRow({
  organizationId,
  capability,
  mayConfigure,
}: {
  organizationId: string;
  capability: ResourceCapability;
  mayConfigure: boolean;
}) {
  const [renameState, rename, renaming] = useActionState(renameCapabilityAction, INITIAL);
  const [archiveState, archive, archiving] = useActionState(archiveCapabilityAction, INITIAL);

  if (!mayConfigure) {
    return (
      <span className="flex items-center gap-2 text-sm">
        {capability.name}
        {capability.archived ? <Badge>Archived</Badge> : null}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <form action={rename} className="flex items-center gap-2">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="capabilityId" value={capability.id} />
          <TextInput
            name="name"
            type="text"
            required
            maxLength={64}
            defaultValue={capability.name}
            aria-label={`Name of skill ${capability.name}`}
            size="small"
          />
          <Button type="submit" disabled={renaming} tone="secondary" size="tiny">
            Rename
          </Button>
        </form>
        <form action={archive}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="capabilityId" value={capability.id} />
          <input type="hidden" name="archived" value={capability.archived ? '0' : '1'} />
          <Button type="submit" disabled={archiving} tone="secondary" size="tiny">
            {capability.archived ? 'Restore' : 'Archive'}
          </Button>
        </form>
        {capability.archived ? <Badge>Archived</Badge> : null}
      </div>
      <ErrorText role="alert">{renameState.error ?? archiveState.error}</ErrorText>
    </div>
  );
}

function AddCapabilityForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(createCapabilityAction, INITIAL);
  const id = useId();

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          id={id}
          name="name"
          type="text"
          required
          maxLength={64}
          placeholder="Skill, e.g. Tire service"
          aria-label="Skill name"
          className="flex-1"
        />
        <Button type="submit" disabled={pending} tone="secondary" className="w-fit">
          {pending ? 'Adding…' : 'Add skill'}
        </Button>
      </div>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
