'use client';

import { createContext, useContext } from 'react';
import type { DialableNumber } from './new-call-form';

export type PopoutCallDraft = {
  numbers: DialableNumber[];
  defaultNumber: DialableNumber | null;
  toNumber: string;
  phoneNumberId: string;
  onReturn?: (draft: { toNumber: string; phoneNumberId: string }) => void;
};

export const DialerPopoutContext = createContext<{
  container: HTMLElement | null;
  error: string | null;
  open: (draft?: PopoutCallDraft) => void;
  close: () => void;
  updateDraft: (draft: { toNumber: string; phoneNumberId: string }) => void;
} | null>(null);

export function useDialerPopout() {
  return useContext(DialerPopoutContext);
}
