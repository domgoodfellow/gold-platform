'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';

export type BootstrapState = { error?: string };

export function GoldBootstrapForm({
  action,
}: {
  action: (state: BootstrapState, formData: FormData) => Promise<BootstrapState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span className="font-medium">GOLD organization ID</span>
        <input
          name="organizationId"
          required
          className="h-10 rounded border border-border bg-background px-3 text-sm"
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </label>
      {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>
        Initialize GOLD workspace
      </Button>
    </form>
  );
}
