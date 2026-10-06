'use client';

import { useActionState } from 'react';
import {
  updateScheduleBufferAction,
  type ScheduleConfigActionState,
} from '@/app/organizations/[organizationId]/schedule/configuration/actions';
import { Button } from '@/components/controls/button';
import { FormField } from '@/components/controls/form';
import { ErrorText, TextInput } from '@/components/controls/inputs';

const INITIAL: ScheduleConfigActionState = { error: null };

export function ScheduleBufferForm({
  organizationId,
  bufferMinutes,
  mayConfigure,
}: {
  organizationId: string;
  bufferMinutes: number;
  mayConfigure: boolean;
}) {
  const [state, formAction, pending] = useActionState(updateScheduleBufferAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <FormField
        id="schedule-buffer-minutes"
        label="Default buffer after scheduled work (minutes)"
        hint="Keeps assigned resources unavailable for this many minutes after scheduled work ends."
      >
        {(field) => (
          <TextInput
            {...field}
            name="bufferMinutes"
            type="number"
            required
            min={0}
            max={1440}
            step={1}
            defaultValue={bufferMinutes}
            disabled={!mayConfigure}
          />
        )}
      </FormField>
      <Button type="submit" disabled={pending || !mayConfigure} className="w-fit">
        {pending ? 'Saving…' : 'Save buffer'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}
