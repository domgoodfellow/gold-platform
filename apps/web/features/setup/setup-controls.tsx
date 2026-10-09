'use client';

import { ErrorText } from '@/components/controls/inputs';
import type { SetupActionState } from '@/app/organizations/[organizationId]/setup/actions';

/** Shared across every setup form below: the one shape `useActionState` returns here. */
export function Error({ state }: { state: SetupActionState }) {
  if (!state.error) return null;
  return (
    <ErrorText role="alert" className="mt-1">
      {state.error}
    </ErrorText>
  );
}

export function Section({ title, children, hidden = false }: { title: string; children: React.ReactNode; hidden?: boolean }) {
  return (
    <section className="mt-6" hidden={hidden}>
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}
