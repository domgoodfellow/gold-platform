'use client';

import { Phone } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { useDialerPopout } from './dialer-popout-context';

export function DialerTrigger() {
  const popout = useDialerPopout();
  if (!popout) return null;
  return <div className="relative flex flex-col items-end">
    <Button type="button" tone="secondary" aria-label="Open dialer" title="Open dialer" className="size-11 p-0" onClick={() => popout.open()}><Phone aria-hidden size={20} /></Button>
    {popout.error ? <span role="alert" className="absolute right-0 top-full mt-2 w-64 rounded-md border border-border bg-background p-3 text-sm text-foreground shadow-md">{popout.error}</span> : null}
  </div>;
}
