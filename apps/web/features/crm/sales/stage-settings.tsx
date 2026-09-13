'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import {
  createStageAction,
  updateStageAction,
  type FormState,
} from '@/app/organizations/[organizationId]/customers/pipeline/actions';

const INITIAL: FormState = { error: null };

/**
 * Naming the stages a relationship moves through.
 *
 * **Nothing here proposes a word.** No placeholder suggests *Prospect*, no default stage says
 * *Qualified* — a platform that seeds no pipeline may not seed one through a form's suggestions
 * either (see `customer_stages`'s own migration comment).
 */

export function CreateStageForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createStageAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          aria-label="Stage name"
          className="flex-1"
        />
        <TextInput
          name="position"
          type="number"
          min={0}
          defaultValue={0}
          aria-label="Where it sits"
          className="w-28"
        />
        <Button type="submit" disabled={pending}>
          Add stage
        </Button>
      </div>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

export function EditStageForm({
  organizationId,
  stage,
}: {
  organizationId: string;
  stage: CustomerStage;
}) {
  const [state, formAction, pending] = useActionState(updateStageAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-2 py-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={stage.id} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <TextInput
          name="name"
          type="text"
          required
          maxLength={64}
          defaultValue={stage.name}
          aria-label="Stage name"
          className="flex-1"
        />
        <TextInput
          name="position"
          type="number"
          min={0}
          defaultValue={stage.position}
          aria-label="Where it sits"
          className="w-28"
        />
        <Button type="submit" tone="secondary" disabled={pending}>
          Save
        </Button>
      </div>

      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}
