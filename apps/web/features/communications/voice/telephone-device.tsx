'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { NavigationActivityContext } from '@/components/navigation/activity-context';
import { Device, type Call } from '@twilio/voice-sdk';
import { mintBrowserTokenAction } from '@/app/organizations/[organizationId]/calls/conference-actions';

/**
 * The one Twilio `Device` this browser tab holds, and the state a dock reads to draw itself.
 *
 * **A context because the SDK is not.** `Device` is a single connection to the carrier that must
 * survive whichever page is on screen while a call is live; a component-local instance would be
 * torn down by the router the moment somebody navigated, hanging up on a customer to look at a
 * different tab. It is mounted by the organization layout, above every page of the business, and
 * `ActiveCallDock` draws from it.
 *
 * **What survives, and what does not.** Moving between pages keeps the call: the Device lives in
 * the layout, which Next does not unmount. A full reload, closing the tab or losing the network
 * does not: the browser's WebRTC connection is the agent's telephone, and it is gone with the page.
 * The call itself carries on at the carrier, so a customer is not dropped by a refresh, but nobody
 * from this business is on it until someone rejoins; the call's own page says so.
 *
 * **Verified against the real SDK only as far as a test can go.** The SDK's documented API is used
 * exactly as documented (`register`, `connect`, `Call.mute`, `Call.sendDigits`, `Call.disconnect`,
 * `tokenWillExpire`), but no browser here has been connected to a live carrier with a microphone.
 */

export type DeviceStatus = 'offline' | 'connecting' | 'ready' | 'error';

export type ActiveCall = {
  status: 'ringing' | 'in_progress' | 'closed';
  direction: 'incoming' | 'outgoing';
  muted: boolean;
  /** When this telephone began the call: dialing started, or the incoming call arrived. Ringing is timed from here. */
  startedAt: number;
  /**
   * When the conversation began: the other person answered a placed call, or this person answered
   * an incoming one. Null while it is still ringing. Talk time is timed from here, never from
   * `startedAt`, and joining the room ahead of the other person does not set it.
   */
  answeredAt?: number | null;
  /** The business number a placed call rings from, as the server resolved it when the call was placed. */
  fromNumber?: string | null;
  /** The business call this telephone belongs to — null for an incoming call until it is answered and identified server-side. */
  callId: string | null;
  contactLabel: string | null;
  /** The contact the call was placed to, when the number was theirs. Attribution belongs to the call, never to whichever list entry is highlighted. */
  customerId?: string | null;
};

/** The call this telephone was last on, kept after it ends so a presentation can offer what follows a call. */
export type EndedCall = {
  callId: string | null;
  contactLabel: string | null;
  customerId: string | null;
  direction: 'incoming' | 'outgoing';
  /** Seconds it rang before it was answered, or before it ended unanswered. */
  ringSeconds?: number;
  /** Seconds of conversation, from the answer to the end; null when nobody answered. */
  durationSeconds: number | null;
  fromNumber?: string | null;
};

type CallMeta = { callId: string; contactLabel: string; customerId?: string | null; fromNumber?: string | null };

export type TelephoneDeviceContextValue = {
  status: DeviceStatus;
  error: string | null;
  activeCall: ActiveCall | null;
  /** The last call this telephone left, until it is dismissed or another call starts. */
  ended?: EndedCall | null;
  dismissEnded?: () => void;
  /**
   * Told when the call's own record shows the other person answered, with that instant when it is
   * known. The first report stands; later ones change nothing.
   */
  noteAnswered?: (at?: number | null) => void;
  incoming: { accept: () => void; reject: () => void } | null;
  register: () => Promise<void>;
  unregister: () => void;
  connectToRoom: (room: string, meta: CallMeta) => Promise<void>;
  hangUp: () => void;
  toggleMute: () => void;
  sendDigits: (digits: string) => void;
};

/** Exported so a test can stand a fake telephone where the real one would be; nothing else provides it. */
export const TelephoneDeviceContext = createContext<TelephoneDeviceContextValue | null>(null);

export function useTelephoneDevice(): TelephoneDeviceContextValue {
  const value = useContext(TelephoneDeviceContext);
  if (!value) throw new Error('useTelephoneDevice must be used within a TelephoneDeviceProvider');
  return value;
}

export function TelephoneDeviceProvider({ organizationId, children }: { organizationId: string; children: ReactNode }) {
  const deviceRef = useRef<Device | null>(null);
  const registration = useRef<Promise<void> | null>(null);
  const callRef = useRef<Call | null>(null);
  const [status, setStatus] = useState<DeviceStatus>('offline');
  const [error, setError] = useState<string | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [ended, setEnded] = useState<EndedCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  // The handlers below outlive the render that attached them, so they read the call from here.
  const current = useRef<ActiveCall | null>(null);
  const update = useCallback((change: ActiveCall | null | ((previous: ActiveCall | null) => ActiveCall | null)) => {
    current.current = typeof change === 'function' ? change(current.current) : change;
    setActiveCall(current.current);
  }, []);
  const dismissEnded = useCallback(() => setEnded(null), []);
  const noteAnswered = useCallback((at?: number | null) => {
    update((prev) => {
      if (!prev || prev.answeredAt != null) return prev;
      const now = Date.now();
      // The instant comes from the server's clock; it is kept inside this call's own span here.
      return { ...prev, answeredAt: Math.min(now, Math.max(prev.startedAt, at ?? now)) };
    });
  }, [update]);

  const attachCallHandlers = useCallback(
    (call: Call, direction: 'incoming' | 'outgoing', meta?: CallMeta) => {
      callRef.current = call;
      setEnded(null);
      update({
        status: 'ringing',
        direction,
        muted: false,
        startedAt: Date.now(),
        answeredAt: null,
        fromNumber: meta?.fromNumber ?? null,
        callId: meta?.callId ?? null,
        contactLabel: meta?.contactLabel ?? null,
        customerId: meta?.customerId ?? null,
      });

      // Accepting an incoming call is the answer. For a placed call it only means this telephone
      // joined the room; the other person answering is reported through `noteAnswered`.
      call.on('accept', () => update((prev) => (prev ? { ...prev, status: 'in_progress', answeredAt: direction === 'incoming' ? Date.now() : prev.answeredAt ?? null } : prev)));
      call.on('disconnect', () => {
        const last = current.current;
        callRef.current = null;
        update(null);
        if (last) {
          const now = Date.now();
          const answeredAt = last.answeredAt ?? null;
          setEnded({
            callId: last.callId,
            contactLabel: last.contactLabel,
            customerId: last.customerId ?? null,
            direction: last.direction,
            ringSeconds: Math.max(0, Math.round(((answeredAt ?? now) - last.startedAt) / 1000)),
            durationSeconds: answeredAt === null ? null : Math.max(0, Math.round((now - answeredAt) / 1000)),
            fromNumber: last.fromNumber ?? null,
          });
        }
      });
      call.on('cancel', () => {
        callRef.current = null;
        update(null);
      });
      call.on('error', (callError) => setError(callError.message));
      call.on('mute', (isMuted) => update((prev) => (prev ? { ...prev, muted: isMuted } : prev)));
    },
    [update],
  );

  /**
   * Resolves when the carrier has accepted this browser as a telephone, not when it has merely been
   * asked to — a caller that dials straight after must not find the Device still connecting.
   */
  const register = useCallback((): Promise<void> => {
    if (registration.current) return registration.current;

    const attempt = (async () => {
      setStatus('connecting');
      setError(null);

      const result = await mintBrowserTokenAction(organizationId);
      if (!result.ok) {
        setStatus('error');
        setError(result.error);
        throw new Error(result.error);
      }

      const device = new Device(result.data.token, { logLevel: 'error' });
      deviceRef.current = device;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('The dialer could not connect. Check your connection and try again.')), 15_000);
        device.on('registered', () => {
          clearTimeout(timer);
          setStatus('ready');
          resolve();
        });
        device.on('unregistered', () => setStatus('offline'));
        device.on('error', (deviceError) => {
          clearTimeout(timer);
          setStatus('error');
          setError(deviceError.message);
          reject(new Error(deviceError.message));
        });
        device.on('tokenWillExpire', async () => {
          const refreshed = await mintBrowserTokenAction(organizationId);
          if (refreshed.ok) device.updateToken(refreshed.data.token);
        });
        device.on('incoming', (call) => {
          setIncomingCall(call);
          attachCallHandlers(call, 'incoming');
        });
        device.register().catch(reject);
      });
    })();

    registration.current = attempt;
    // A failed attempt must not be remembered, or the dialer could never be retried.
    attempt.catch(() => {
      registration.current = null;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    });
    return attempt;
  }, [organizationId, attachCallHandlers]);

  const unregister = useCallback(() => {
    deviceRef.current?.destroy();
    deviceRef.current = null;
    registration.current = null;
    setStatus('offline');
    update(null);
  }, [update]);

  useEffect(() => () => unregister(), [unregister]);

  /**
   * Joins the room `placeCall` already created and rang the customer into. `Conference` is the
   * one parameter `voice_outbound.py` reads — everything else about who this call is stays on the
   * `calls`/`call_participants` rows this room already names.
   */
  const connectToRoom = useCallback(
    async (room: string, meta: CallMeta) => {
      await register();
      const device = deviceRef.current;
      if (!device) throw new Error('The dialer is not ready.');
      const call = await device.connect({ params: { Conference: room } });
      attachCallHandlers(call, 'outgoing', meta);
    },
    [register, attachCallHandlers],
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
          update(null);
        },
      }
    : null;

  return (
    <TelephoneDeviceContext.Provider
      value={{ status, error, activeCall, ended, dismissEnded, noteAnswered, incoming, register, unregister, connectToRoom, hangUp, toggleMute, sendDigits }}
    >
      <NavigationActivityContext.Provider value={!!activeCall || !!incomingCall}>{children}</NavigationActivityContext.Provider>
    </TelephoneDeviceContext.Provider>
  );
}
