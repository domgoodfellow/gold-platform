'use client';

import { createContext, useContext } from 'react';
import type { CallingBlocker, OutboundLine } from '@/lib/application/communications/calling-options';

/** Why calling cannot start, as the window draws it: the kind, the reason, and where it is fixed when the viewer may go there. */
export type PopoutBlocker = { kind: CallingBlocker['kind']; reason: string; setup?: { href: string; label: string } | null };

export type PopoutCallDraft = {
  numbers: OutboundLine[];
  defaultNumber: OutboundLine | null;
  toNumber: string;
  phoneNumberId: string;
  customerId?: string;
  customerName?: string;
  /** Whether this member may type in any number. Without it the window calls only the number it was opened with. */
  manualDialing?: boolean;
  /** Why calling cannot start, when whoever opened the window already knows. */
  blocker?: PopoutBlocker | null;
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
