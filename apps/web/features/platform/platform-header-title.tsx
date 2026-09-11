'use client';

import { useEffect, useSyncExternalStore } from 'react';

let currentTitle: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(title: string | null) {
  currentTitle = title;
  listeners.forEach((listener) => listener());
}

export function usePlatformHeaderOverride() {
  return useSyncExternalStore(subscribe, () => currentTitle, () => null);
}

export function PlatformHeaderTitle({ children }: { children: string }) {
  useEffect(() => {
    publish(children);
    return () => publish(null);
  }, [children]);
  return null;
}
