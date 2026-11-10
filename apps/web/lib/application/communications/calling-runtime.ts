import { callbackBase, telephonyProvider } from '@/lib/adapters/telephony';

/** Whether this deployment can place a call at all: a telephony provider and a callback address. Screens ask this rather than importing the adapter. */
export async function callingRuntimeConfigured(mayCall: boolean): Promise<boolean> {
  return mayCall && !!callbackBase() && !!(await telephonyProvider());
}
