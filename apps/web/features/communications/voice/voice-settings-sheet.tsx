'use client';

import Link from 'next/link';
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { DividedList, EmptyState, GroupHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { PageDrawer, PageDrawerContent, PageDrawerDescription, PageDrawerHeader, PageDrawerTitle, PageDrawerTrigger } from '@/components/containers/page-drawer';
import { configTarget } from '@/lib/navigation';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import type { Route } from '@/lib/domain/reception/routing';
import { OutboundIdentity } from './outbound-identity';
import { CreateOutcomeForm } from './outcome-settings';
import { RoutingSection } from './routing-section';

/**
 * Communications' one Configure surface (`call-setup`, `calls#setup`). Eight sections, each a
 * concern the work order named — most are truthful "not yet" states rather than editable
 * controls, because a control with nothing behind it is worse than no control (D31).
 */
export function VoiceSettingsSheet({ organizationId, number, outcomes, routes, numbers, members, mayManageIdentity, mayConfigureOutcomes, role }: {
  organizationId: string;
  number: string | null;
  outcomes: CallOutcome[];
  routes: Route[];
  numbers: { id: string; e164: string; label: string | null }[];
  members: { id: string; displayName: string }[];
  mayManageIdentity: boolean;
  mayConfigureOutcomes: boolean;
  role: string;
}) {
  return (
    <PageDrawer>
      <PageDrawerTrigger asChild><Button type="button" tone="secondary"><Settings2 aria-hidden /> Communications settings</Button></PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader><PageDrawerTitle>Communications settings</PageDrawerTitle><PageDrawerDescription>Voice, messaging, routing and the words this business uses after a call.</PageDrawerDescription></PageDrawerHeader>
        <div className="space-y-8 px-4 pb-4">
          <section>
            <GroupHeading>Voice</GroupHeading>
            {outcomes.length === 0 ? <EmptyState className="mt-2">No outcomes named.</EmptyState> : (
              <DividedList className="mt-2">{outcomes.map((outcome) => <li key={outcome.id} className="flex items-center justify-between gap-3 py-2"><span>{outcome.name}</span><span className="text-xs text-muted">{outcome.reached ? 'Reached' : 'Not reached'}</span></li>)}</DividedList>
            )}
            {mayConfigureOutcomes ? <div className="mt-4"><CreateOutcomeForm organizationId={organizationId} /></div> : <Hint className="mt-3">Your role, {role}, cannot change these words.</Hint>}
          </section>
          <section>
            <GroupHeading>Messaging</GroupHeading>
            <Hint className="mt-2">Text messaging is not available on this deployment yet.</Hint>
          </section>
          <section>
            <GroupHeading>Routing</GroupHeading>
            <div className="mt-2">
              {mayConfigureOutcomes ? (
                <RoutingSection organizationId={organizationId} routes={routes} numbers={numbers} members={members} />
              ) : (
                <Hint>Your role, {role}, cannot change routing.</Hint>
              )}
            </div>
          </section>
          <section>
            <GroupHeading>Caller identity</GroupHeading>
            {mayManageIdentity ? <OutboundIdentity organizationId={organizationId} number={number} /> : <Hint className="mt-2">{number ?? 'None set.'} Your role, {role}, cannot change it.</Hint>}
          </section>
          <section>
            <GroupHeading>Business hours</GroupHeading>
            <Hint className="mt-2">
              Set under <Link href={`/organizations/${organizationId}/${configTarget('schedule-configuration').path}`} className="underline">Working hours</Link>, the one place this business&apos;s week is recorded.
            </Hint>
          </section>
          <section>
            <GroupHeading>Recording</GroupHeading>
            <Hint className="mt-2">Every call is recorded. There is no setting to turn it off yet.</Hint>
          </section>
          <section>
            <GroupHeading>Compliance</GroupHeading>
            <Hint className="mt-2">No compliance controls are configurable here yet.</Hint>
          </section>
          <section>
            <GroupHeading>Advanced</GroupHeading>
            <Hint className="mt-2">Carrier-level settings belong to the platform, not to a business&apos;s own account, and are never configured here.</Hint>
          </section>
        </div>
      </PageDrawerContent>
    </PageDrawer>
  );
}
