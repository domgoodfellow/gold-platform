import { callbackBase, telephonyProvider } from '@/lib/adapters/telephony';

/** Whether this deployment can place a call at all: a telephony provider and a callback address. Screens ask this rather than importing the adapter. */
export function callingRuntimeConfigured(mayCall: boolean): boolean {
  return mayCall && !!telephonyProvider() && !!callbackBase();
}
