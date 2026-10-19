'use client';

import { useState, type ReactNode } from 'react';
import { TelephoneDeviceContext, type TelephoneDeviceContextValue } from '@/features/communications/voice/telephone-device';

/**
 * Development fixture only: a telephone that reports one connected outgoing call and does
 * nothing when used. It never mints a token, registers or reaches a carrier, so the live-call
 * console can be rendered and inspected without placing a call.
 */
export function TestTelephone({ callId, contactLabel, children }: { callId: string; contactLabel: string; children: ReactNode }) {
  const [startedAt] = useState(() => Date.now() - 137_000);
  const [muted, setMuted] = useState(false);
  const value: TelephoneDeviceContextValue = {
    status: 'ready',
    error: null,
    activeCall: { status: 'in_progress', direction: 'outgoing', muted, startedAt, callId, contactLabel },
    incoming: null,
    register: async () => undefined,
    unregister: () => undefined,
    connectToRoom: async () => undefined,
    hangUp: () => undefined,
    toggleMute: () => setMuted((value) => !value),
    sendDigits: () => undefined,
  };
  return <TelephoneDeviceContext.Provider value={value}>{children}</TelephoneDeviceContext.Provider>;
}
