'use client';

import { Button } from '@/components/controls/button';
import { useTelephoneDevice, type DeviceStatus } from './telephone-device';

/** One wording for this browser's telephone connection, wherever a presentation states it. */
export const BROWSER_PHONE_STATUS: Record<DeviceStatus, string> = {
  offline: 'Connects when needed',
  connecting: 'Connecting',
  ready: 'Connected',
  error: 'Connection failed',
};

/**
 * This browser's telephone: whether it is connected, and the choice to take incoming calls here.
 * The Dialer and the pop-out window both draw it, so the two never word one state two ways.
 *
 * Stopping is not offered during a call: it closes the telephone the call is on.
 */
export function BrowserPhone() {
  const { status, error, activeCall, incoming, register, unregister } = useTelephoneDevice();
  const onCall = activeCall !== null || incoming !== null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="flex-1 whitespace-nowrap">
          <span className="text-muted">Browser phone</span>{' '}
          <span data-state={status} className={status === 'error' ? 'font-medium text-danger' : 'font-medium'}>{BROWSER_PHONE_STATUS[status]}</span>
        </span>
        <Button
          type="button"
          tone="text"
          size="small"
          disabled={status === 'connecting' || onCall}
          onClick={() => { if (status === 'ready') unregister(); else void register().catch(() => undefined); }}
        >
          {status === 'ready' ? 'Stop receiving calls' : 'Receive calls here'}
        </Button>
      </div>
      {error ? <p role="alert" className="mt-2 text-sm text-danger">{error}</p> : null}
    </>
  );
}
