'use client';

import { createContext, useContext } from 'react';
import type { DialableNumber } from './new-call-form';

export type PopoutCallDraft = {
  numbers: DialableNumber[];
  defaultNumber: DialableNumber | null;
  toNumber: string;
  phoneNumberId: string;
  customerId?: string;
  customerName?: string;
  /** Why calling cannot start, when whoever opened the window already knows. */
  blockedReason?: string;
  onReturn?: (draft: { toNumber: string; phoneNumberId: string }) => void;
};

export const DialerPopoutContext = createContext<{
  container: HTMLElement | null;
  error: string | null;
  open: (draft?: PopoutCallDraft) => void;
  close: () => void;
  updateDraft: (draft: { toNumber: string; phoneNumberId: string }) => void;
  /** True while the Dialer page itself draws the live call controls, so the organization dock steps aside. */
  inlineHost: boolean;
  setInlineHost: (hosted: boolean) => void;
} | null>(null);

export function useDialerPopout() {
  return useContext(DialerPopoutContext);
}
