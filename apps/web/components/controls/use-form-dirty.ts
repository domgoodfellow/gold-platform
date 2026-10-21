'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

function snapshot(form: HTMLFormElement): string {
  return JSON.stringify([...new FormData(form)].filter(([, value]) => typeof value === 'string'));
}

/**
 * Whether an uncontrolled form now differs from what it opened with, by comparing its submitted
 * values — so typing a value and deleting it again is not a change. Attach `ref` and `onChange` to
 * the `<form>`. The comparison runs after the event, because the source-owned checkbox is a Radix
 * button that updates its hidden input only once it has re-rendered.
 */
export function useFormDirty() {
  const ref = useRef<HTMLFormElement>(null);
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (ref.current) baseline.current = snapshot(ref.current);
  }, []);

  const onChange = useCallback(() => {
    window.setTimeout(() => {
      const form = ref.current;
      if (form && baseline.current !== null) setDirty(snapshot(form) !== baseline.current);
    }, 0);
  }, []);

  return { ref, dirty, onChange };
}
