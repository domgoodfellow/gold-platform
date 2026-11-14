'use client';

import { useState, type ReactNode } from 'react';
import { TelephoneDeviceContext, type TelephoneDeviceContextValue } from '@/features/communications/voice/telephone-device';

/** The point in a call's life the fixture stands at. */
export type TestTelephoneState = 'connected' | 'ringing' | 'incoming' | 'ended';

/**
 * Development fixture only: a telephone that reports one call at a chosen point in its life and
 * never reaches a carrier. It mints no token and registers nothing, so each state of the calling
 * workspace can be rendered and inspected without placing a call. Hanging up, answering and
 * declining move the fixture on as a real telephone would, so what follows a call can be seen too.
 */
export function TestTelephone({ callId, contactLabel, customerId = null, state: initial = 'connected', children }: { callId: string; contactLabel: string; customerId?: string | null; state?: TestTelephoneState; children: ReactNode }) {
  const [startedAt] = useState(() => Date.now() - 137_000);
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<TestTelephoneState | 'idle'>(initial);
  const onCall = state === 'connected' || state === 'ringing';
  const value: TelephoneDeviceContextValue = {
    status: 'ready',
    error: null,
    activeCall: onCall ? { status: state === 'ringing' ? 'ringing' : 'in_progress', direction: 'outgoing', muted, startedAt, callId, contactLabel, customerId } : null,
    ended: state === 'ended' ? { callId, contactLabel, customerId, direction: 'outgoing', durationSeconds: 137 } : null,
    dismissEnded: () => setState('idle'),
    incoming: state === 'incoming' ? { accept: () => setState('connected'), reject: () => setState('idle') } : null,
    register: async () => undefined,
    unregister: () => undefined,
    connectToRoom: async () => undefined,
    hangUp: () => setState('ended'),
    toggleMute: () => setMuted((value) => !value),
    sendDigits: () => undefined,
  };
  return <TelephoneDeviceContext.Provider value={value}>{children}</TelephoneDeviceContext.Provider>;
}
