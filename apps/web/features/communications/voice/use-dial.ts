'use client';

import { useState } from 'react';
import { dialAction, endCallAction } from '@/app/organizations/[organizationId]/calls/conference-actions';
import { useTelephoneDevice } from './telephone-device';

/**
 * Place a call from this browser: ask the server to ring the number into a room, then join this
 * telephone to the same room. One path for every screen that dials, so a call placed from the Calls
 * workspace and one placed from a customer behave identically.
 *
 * **If the second half fails the first is undone.** A browser that cannot get a microphone, or loses
 * the connection, after the customer's telephone is already ringing would leave a person answering
 * to silence. The call is hung up and the reason shown.
 */
export function useDial(organizationId: string) {
  const device = useTelephoneDevice();
  const [dialing, setDialing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dial = async (input: {
    toNumber: string;
    contactLabel: string;
    customerId?: string | null;
    phoneNumberId?: string | null;
  }): Promise<boolean> => {
    setDialing(true);
    setError(null);
    try {
      await device.register();
      const placed = await dialAction(organizationId, {
        customerId: input.customerId,
        toNumber: input.toNumber,
        phoneNumberId: input.phoneNumberId,
      });
      if (!placed.ok) {
        setError(placed.error);
        return false;
      }
      try {
        await device.connectToRoom(placed.data.room, { callId: placed.data.callId, contactLabel: input.contactLabel });
      } catch (cause) {
        await endCallAction(organizationId, { callId: placed.data.callId });
        throw cause;
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not place that call.');
      return false;
    } finally {
      setDialing(false);
    }
  };

  return { dial, dialing, error };
}
