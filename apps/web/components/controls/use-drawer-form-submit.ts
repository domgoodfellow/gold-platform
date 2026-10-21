'use client';

import { useEffect, useRef, useTransition, type FormEvent } from 'react';

/**
 * The submit lifecycle of an editing form inside a `PageDrawer` whose footer holds its buttons:
 *
 * - it submits through a transition rather than `<form action>`, so a refused save keeps what was
 *   typed (React resets an action form after every completed action, refusals included);
 * - one submission at a time;
 * - focus moves to the refusal (`errorRef`, a focusable wrapper around the form's `FormError`), so it
 *   is read and Escape still reaches the drawer after a disabled pending button dropped focus;
 * - pending is reported to the footer that owns the submit button.
 */
export function useDrawerFormSubmit<State extends { error: string | null }>(
  formAction: (data: FormData) => void,
  state: State,
  pending: boolean,
  onPendingChange?: (pending: boolean) => void,
) {
  const [, startTransition] = useTransition();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [pending, onPendingChange]);

  useEffect(() => {
    if (state.error && !pending) errorRef.current?.focus();
  }, [state, pending]);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  return { onSubmit, errorRef };
}
