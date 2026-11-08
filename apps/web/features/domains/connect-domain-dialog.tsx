'use client';

import { useEffect, useReducer, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/controls/confirm-submit';
import { applyDnsAutomationAction, checkDomainAction, connectDomainAction } from '@/app/organizations/[organizationId]/settings/domains/actions';
import { DOMAIN_SURFACES } from '@/lib/domain/domains/presentation';
import { connectDomainFlow, INITIAL_FLOW, type FlowState } from './connect-domain-flow';
import { DnsRecordTable } from './dns-record-table';
import { DomainStateBadge } from './domain-status';

/**
 * Connect a domain the business owns: name it, choose which surface it opens, then read what the
 * hosting provider asked for and check again once DNS is published. Every step's rule is the
 * domain layer's (`connectDomainFlow` only sequences); every answer is also written on the domain's
 * row, so closing this halfway loses nothing — the Domains list shows the same state.
 */
export function ConnectDomainDialog({
  organizationId,
  platformZone,
}: {
  organizationId: string;
  platformZone: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(connectDomainFlow, INITIAL_FLOW);

  useEffect(() => {
    if (state.step !== 'working') return;
    let cancelled = false;
    const request =
      state.action === 'apply' && state.domainId
        ? applyDnsAutomationAction({ organizationId, domainId: state.domainId })
        : state.action === 'check' && state.domainId
          ? checkDomainAction({ organizationId, domainId: state.domainId })
          : connectDomainAction({ organizationId, hostname: state.hostname, surface: state.surface });
    request
      .then((result) => {
        if (!cancelled) dispatch({ type: 'answered', result });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'answered', result: { ok: false, message: 'That could not be completed.' } });
      })
      .finally(() => router.refresh());
    return () => {
      cancelled = true;
    };
  }, [state, organizationId, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) dispatch({ type: 'reset' });
      }}
    >
      <DialogTrigger asChild>
        <Button type="button">Connect domain</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <ConnectDomainStep state={state} platformZone={platformZone} dispatch={dispatch} />
      </DialogContent>
    </Dialog>
  );
}

type Dispatch = (event: Parameters<typeof connectDomainFlow>[1]) => void;

/** The body for one step. Exported so each state renders on its own in a test, with no network. */
export function ConnectDomainStep({
  state,
  platformZone,
  dispatch,
}: {
  state: FlowState;
  platformZone: string | null;
  dispatch: Dispatch;
}) {
  switch (state.step) {
    case 'hostname':
      return (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch({ type: 'continue', platformZone });
          }}
        >
          <DialogHeader>
            <DialogTitle>Connect a domain</DialogTitle>
            <DialogDescription>A domain you own, such as www.example.com. You will publish DNS records at the company you bought it from.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="domain-hostname">Domain</FieldLabel>
            <TextInput
              id="domain-hostname"
              value={state.hostname}
              autoComplete="off"
              spellCheck={false}
              placeholder="www.example.com"
              onChange={(event) => dispatch({ type: 'edit', hostname: event.target.value })}
              aria-invalid={state.problem ? true : undefined}
              aria-describedby={state.problem ? 'domain-hostname-problem' : undefined}
            />
            <ErrorText id="domain-hostname-problem" role="alert">{state.problem}</ErrorText>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit">Continue</Button>
          </DialogFooter>
        </form>
      );

    case 'surface':
      return (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            dispatch({ type: 'submit' });
          }}
        >
          <DialogHeader>
            <DialogTitle>What should {state.hostname} open?</DialogTitle>
            <DialogDescription>You can connect another domain for the other one later.</DialogDescription>
          </DialogHeader>
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Surface</legend>
            {DOMAIN_SURFACES.map((surface) => (
              <label key={surface.key} className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
                <input
                  type="radio"
                  name="surface"
                  value={surface.key}
                  checked={state.surface === surface.key}
                  onChange={() => dispatch({ type: 'choose', surface: surface.key })}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">{surface.label}</span>
                  <span className="block text-sm text-muted">{surface.description}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <DialogFooter>
            <Button type="button" tone="secondary" onClick={() => dispatch({ type: 'back' })}>Back</Button>
            <Button type="submit">Connect</Button>
          </DialogFooter>
        </form>
      );

    case 'working':
      return (
        <div className="flex flex-col gap-4" aria-live="polite">
          <DialogHeader>
            <DialogTitle>{state.hostname}</DialogTitle>
            <DialogDescription>
              {state.action === 'apply'
                ? 'Publishing DNS through your connected account, then checking…'
                : state.action === 'check'
                  ? 'Checking…'
                  : 'Registering…'}
            </DialogDescription>
          </DialogHeader>
        </div>
      );

    case 'dns':
      return (
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {state.hostname} <DomainStateBadge presentation="pending_dns" />
            </DialogTitle>
            <DialogDescription>
              {state.dnsAutomation.available
                ? state.rechecked
                  ? `Checked again: DNS is still settling. These are the records GildOps would publish through your connected ${state.dnsAutomation.zoneName ?? 'Cloudflare'} account.`
                  : `This domain's DNS is reachable through your connected ${state.dnsAutomation.zoneName ?? 'Cloudflare'} account. Review the records below, then press Apply and verify to publish them — nothing is written until you do.`
                : state.rechecked
                  ? 'Checked again: DNS for this domain does not point here yet. Make sure these records are published exactly as shown. Changes can take a while to spread.'
                  : 'Publish these records at your DNS host, then check again.'}
            </DialogDescription>
          </DialogHeader>
          <DnsRecordTable records={state.records} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="secondary">Finish later</Button>
            </DialogClose>
            <Button type="button" tone="secondary" onClick={() => dispatch({ type: 'recheck' })}>Check again</Button>
            {state.dnsAutomation.available ? (
              <Button type="button" onClick={() => dispatch({ type: 'apply' })}>Apply and verify</Button>
            ) : null}
          </DialogFooter>
        </div>
      );

    case 'active':
      return (
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {state.hostname} <DomainStateBadge presentation="active" />
            </DialogTitle>
            <DialogDescription>Verified and serving. It can take a minute before every visitor reaches it.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button">Done</Button>
            </DialogClose>
          </DialogFooter>
        </div>
      );

    case 'conflict':
      return (
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {state.hostname} <DomainStateBadge presentation="conflict" />
            </DialogTitle>
            <DialogDescription>{state.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" tone="secondary" onClick={() => dispatch({ type: 'reset' })}>Use another domain</Button>
          </DialogFooter>
        </div>
      );

    case 'unavailable':
    case 'error':
      return (
        <div className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {state.hostname}{' '}
              <DomainStateBadge presentation={state.step === 'unavailable' ? 'provider_unavailable' : 'provider_error'} />
            </DialogTitle>
            <DialogDescription>{state.message}</DialogDescription>
          </DialogHeader>
          {state.domainId ? (
            <Hint>The domain is saved. It is listed on this page, and you can check it again from there at any time.</Hint>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="secondary">Close</Button>
            </DialogClose>
            {state.domainId ? (
              <Button type="button" onClick={() => dispatch({ type: 'recheck' })}>Try again</Button>
            ) : null}
          </DialogFooter>
        </div>
      );
  }
}
