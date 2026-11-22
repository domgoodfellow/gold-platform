'use client';

import { useRef, useState, useTransition } from 'react';
import { CircleCheck, ListChecks } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@gold/ui/components/popover';
import { Progress } from '@gold/ui/components/progress';
import { Button, ButtonLink } from '@/components/controls/button';
import { DividedList } from '@/components/surfaces/section';
import type { SetupStatus } from '@/lib/application/setup/status';
import { setupStatusAction } from '@/app/organizations/[organizationId]/setup/status-actions';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Setup as a compact header status while the business is in SETUP: what still blocks launch and a
 * way into the Setup page, which keeps the checklist and the Launch control. It opens only when
 * someone chooses it, and reads `computeSetupOverview` again each time it opens, so a step finished
 * elsewhere is reflected without reloading. It is not a notification centre and holds no state of
 * its own; after launch it disappears.
 */
export function SetupStatusControl({ organizationId, initial }: { organizationId: string; initial: SetupStatus }) {
  const [open, setOpen] = useState(false);
  // A refreshed answer applies only to the status the shell last drew; a newer server render wins.
  const [refreshed, setRefreshed] = useState<{ from: SetupStatus; value: SetupStatus } | null>(null);
  const [pending, start] = useTransition();
  const generation = useRef(0);
  const status = refreshed && refreshed.from === initial ? refreshed.value : initial;

  const refresh = () => {
    const mine = ++generation.current;
    start(async () => {
      let value: SetupStatus;
      try { value = await setupStatusAction(organizationId); } catch { value = { state: 'unavailable', mayLaunch: status.state === 'live' ? false : status.mayLaunch }; }
      if (generation.current === mine) setRefreshed({ from: initial, value });
    });
  };
  const changeOpen = (next: boolean) => { setOpen(next); if (next) refresh(); };

  if (status.state === 'live') return null;
  const required = status.state === 'open' ? status.required.length : 0;
  const name = status.state === 'unavailable' ? 'Setup. Status unavailable.'
    : required ? `Setup. ${plural(required, 'required step remains', 'required steps remain')}.` : 'Setup. Ready to launch.';
  const href = `/organizations/${organizationId}/setup`;
  const action = !status.mayLaunch ? 'View setup' : status.state === 'open' && !required ? 'Review and launch' : 'Review setup';

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <Button type="button" tone="secondary" aria-label={name} data-setup-state={status.state === 'open' ? required ? 'required' : 'ready' : 'unavailable'} className="h-9 shrink-0 gap-1.5 px-2 max-md:h-11 max-md:min-w-11">
        {status.state === 'open' && !required ? <CircleCheck aria-hidden className="size-5" /> : <ListChecks aria-hidden className="size-5" />}
        <span className="hidden lg:inline">Setup</span>
        {required ? <span aria-hidden className="min-w-5 rounded-full bg-accent px-1.5 text-center text-xs font-semibold tabular-nums text-on-accent">{required}</span> : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" aria-labelledby="setup-status-title" className="flex max-h-[calc(100dvh-6rem)] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h2 id="setup-status-title" className="text-sm font-semibold">Setup</h2>
        {pending ? <span role="status" className="text-xs text-muted">Updating…</span> : null}
      </div>
      <div className="min-h-0 overflow-y-auto px-4 py-3 text-sm" aria-busy={pending}>
        {status.state === 'unavailable' ? <div role="status" className="space-y-3">
          <p>Setup status is unavailable.</p>
          <Button tone="secondary" size="small" onClick={refresh} disabled={pending}>Try again</Button>
        </div> : <>
          <p className="font-medium">{required ? plural(required, 'required step remains', 'required steps remain') : 'Required setup is complete'}</p>
          {status.total ? <div className="mt-2">
            <p className="text-xs tabular-nums text-muted">{status.ready} of {status.total} setup areas ready, optional ones included</p>
            <Progress value={Math.round((status.ready / status.total) * 100)} className="mt-1.5" aria-label={`${status.ready} of ${status.total} setup areas ready`} />
          </div> : null}
          {required ? <DividedList className="mt-3" aria-label="Required before launch">
            {status.required.map(step => <li key={step.key} className="py-2"><p className="font-medium">{step.label}</p><p className="mt-0.5 text-xs text-muted">{step.message}</p></li>)}
          </DividedList> : null}
          {!status.mayLaunch ? <p className="mt-3 text-xs text-muted">{required ? 'An organization manager can finish setup.' : 'An organization manager can launch this business.'}</p> : null}
        </>}
      </div>
      <div className="flex justify-end border-t border-border p-3">
        <ButtonLink href={href} size="small" tone={status.mayLaunch ? 'primary' : 'secondary'} onClick={() => setOpen(false)}>{action}</ButtonLink>
      </div>
    </PopoverContent>
  </Popover>;
}
