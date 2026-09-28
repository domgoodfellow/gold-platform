'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Device, type Call } from '@twilio/voice-sdk';
import { mintBrowserTokenAction } from '@/app/organizations/[organizationId]/calls/conference-actions';

/**
 * The one Twilio `Device` this browser tab holds, and the state a dock reads to draw itself.
 *
 * **A context because the SDK is not.** `Device` is a single connection to the carrier that must
 * survive whichever page is on screen while a call is live; a component-local instance would be
 * torn down by the router the moment somebody navigated, hanging up on a customer to look at a
 * different tab. Scoped to the Calls page today, not the whole organization shell — going further
 * than that is a decision about the shell's own persistence, not this capability's.
 *
 * **Everything here is unverified against a live call.** The SDK's documented API is used exactly
 * as documented (`register`, `connect`, `Call.mute`, `Call.sendDigits`, `Call.disconnect`,
 * `tokenWillExpire`), but no browser, microphone or carrier has exercised this file — it has not
 * rung a real phone. Manual verification is the one thing this change still needs.
 */

export type DeviceStatus = 'offline' | 'connecting' | 'ready' | 'error';

export type ActiveCall = {
  callSid: string | null;
  status: 'ringing' | 'in_progress' | 'closed';
  direction: 'incoming' | 'outgoing';
  muted: boolean;
  startedAt: number;
  /** The room this leg is meant to join — carried through so the dock can look up participants. */
  room: string | null;
  /** The Gild call row this leg belongs to — null for an incoming call until it is answered and identified server-side. */
  callId: string | null;
  contactLabel: string | null;
};

type TelephoneDeviceContextValue = {
  status: DeviceStatus;
  error: string | null;
  activeCall: ActiveCall | null;
  incoming: { accept: () => void; reject: () => void } | null;
  register: () => Promise<void>;
  unregister: () => void;
  connectToRoom: (room: string, meta: { callId: string; contactLabel: string }) => Promise<void>;
  hangUp: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
};

const TelephoneDeviceContext = createContext<TelephoneDeviceContextValue | null>(null);

export function useTelephoneDevice(): TelephoneDeviceContextValue {
  const value = useContext(TelephoneDeviceContext);
  if (!value) throw new Error('useTelephoneDevice must be used within a TelephoneDeviceProvider');
  return value;
}

export function TelephoneDeviceProvider({ organizationId, children }: { organizationId: string; children: ReactNode }) {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [status, setStatus] = useState<DeviceStatus>('offline');
  const [error, setError] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);

  const attachCallHandlers = useCallback(
    (call: Call, direction: 'incoming' | 'outgoing', room: string | null, meta?: { callId: string; contactLabel: string }) => {
      callRef.current = call;
      setActiveCall({
        callSid: call.parameters.CallSid ?? null,
        status: 'ringing',
        direction,
        muted: false,
        startedAt: Date.now(),
        room,
        callId: meta?.callId ?? null,
        contactLabel: meta?.contactLabel ?? null,
      });

      call.on('accept', () => setActiveCall((prev) => (prev ? { ...prev, status: 'in_progress' } : prev)));
      call.on('disconnect', () => {
        callRef.current = null;
        setActiveCall(null);
      });
      call.on('cancel', () => {
        callRef.current = null;
        setActiveCall(null);
      });
      call.on('error', (callError) => setError(callError.message));
      call.on('mute', (isMuted) => setActiveCall((prev) => (prev ? { ...prev, muted: isMuted } : prev)));
    },
    [],
  );

  const register = useCallback(async () => {
    if (deviceRef.current) return;
    setStatus('connecting');
    setError(null);

    const result = await mintBrowserTokenAction(organizationId);
    if (!result.ok) {
      setStatus('error');
      setError(result.error);
      return;
    }

    const device = new Device(result.data.token, { logLevel: 'error' });
    deviceRef.current = device;

    device.on('registered', () => setStatus('ready'));
    device.on('unregistered', () => setStatus('offline'));
    device.on('error', (deviceError) => {
      setStatus('error');
      setError(deviceError.message);
    });
    device.on('tokenWillExpire', async () => {
      const refreshed = await mintBrowserTokenAction(organizationId);
      if (refreshed.ok) device.updateToken(refreshed.data.token);
    });
    device.on('incoming', (call) => {
      setIncomingCall(call);
      attachCallHandlers(call, 'incoming', null);
    });

    await device.register();
  }, [organizationId, attachCallHandlers]);

  const unregister = useCallback(() => {
    deviceRef.current?.destroy();
    deviceRef.current = null;
    setStatus('offline');
    setActiveCall(null);
  }, []);

  useEffect(() => () => unregister(), [unregister]);

  /**
   * Joins the room `placeCall` already created and rang the customer into. `Conference` is the
   * one parameter `voice_outbound.py` reads (D38's own agent leg) — everything else about who
   * this call is stays on the `calls`/`call_participants` rows this room already names.
   */
  const connectToRoom = useCallback(
    async (room: string, meta: { callId: string; contactLabel: string }) => {
      if (!deviceRef.current || status !== 'ready') {
        throw new Error('The dialer is not registered yet.');
      }
      const call = await deviceRef.current.connect({ params: { Conference: room } });
      attachCallHandlers(call, 'outgoing', room, meta);
    },
    [status, attachCallHandlers],
  );

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
  }, []);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    call.mute(!call.isMuted());
  }, []);

  const sendDigits = useCallback((digits: string) => {
    callRef.current?.sendDigits(digits);
  }, []);

  const incoming = incomingCall
    ? {
        accept: () => {
          incomingCall.accept();
          setIncomingCall(null);
        },
        reject: () => {
          incomingCall.reject();
          setIncomingCall(null);
          callRef.current = null;
          setActiveCall(null);
        },
      }
    : null;

  return (
    <TelephoneDeviceContext.Provider
      value={{ status, error, activeCall, incoming, register, unregister, connectToRoom, hangUp, toggleMute, sendDigits }}
    >
      {children}
    </TelephoneDeviceContext.Provider>
  );
}
