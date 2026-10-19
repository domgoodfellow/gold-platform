'use client';

import { formatPhoneForDisplay } from '@/lib/display/phone';
import Link from 'next/link';
import { DividedList, EmptyState, GroupHeading } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { configTarget } from '@/lib/navigation';
import type { CallOutcome } from '@/lib/domain/reception/outcomes';
import type { Route } from '@/lib/domain/reception/routing';
import { OutboundIdentity } from './outbound-identity';
import { CreateOutcomeForm } from './outcome-settings';
import { RoutingSection } from './routing-section';

type VoiceSettingsProps = {
  organizationId: string;
  number: string | null;
  outcomes: CallOutcome[];
  routes: Route[];
  numbers: { id: string; e164: string; label: string | null }[];
  members: { id: string; displayName: string }[];
  mayManageIdentity: boolean;
  mayConfigureOutcomes: boolean;
  role: string;
};

export function VoiceSettingsContent({ organizationId, number, outcomes, routes, numbers, members, mayManageIdentity, mayConfigureOutcomes, role }: VoiceSettingsProps) {
 return (
        <div className="space-y-4">
          <section id="outcomes" className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
            <GroupHeading>Voice</GroupHeading>
            {outcomes.length === 0 ? <EmptyState className="mt-2">No outcomes named.</EmptyState> : (
              <DividedList className="mt-2">{outcomes.map((outcome) => <li key={outcome.id} className="flex items-center justify-between gap-3 py-2"><span>{outcome.name}</span><span className="text-xs text-muted">{outcome.reached ? 'Reached' : 'Not reached'}</span></li>)}</DividedList>
            )}
            {mayConfigureOutcomes ? <div className="mt-4"><CreateOutcomeForm organizationId={organizationId} /></div> : <Hint className="mt-3">Your role, {role}, cannot change these words.</Hint>}
          </section>
          <section id="routing" className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
            <GroupHeading>Routing</GroupHeading>
            <div className="mt-2">
              {mayConfigureOutcomes ? (
                <RoutingSection organizationId={organizationId} routes={routes} numbers={numbers} members={members} />
              ) : (
                <Hint>Your role, {role}, cannot change routing.</Hint>
              )}
            </div>
          </section>
          <section id="caller-identity" className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
            <GroupHeading>Caller identity</GroupHeading>
            {mayManageIdentity ? <OutboundIdentity organizationId={organizationId} number={number} /> : <Hint className="mt-2">{number ? formatPhoneForDisplay(number) : 'None set.'} Your role, {role}, cannot change it.</Hint>}
          </section>
          <section id="business-hours" className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
            <GroupHeading>Business hours</GroupHeading>
            <Hint className="mt-2">
              Set under <Link href={`/organizations/${organizationId}/${configTarget('schedule-configuration').path}`} className="underline">Working hours</Link>, the one place this business&apos;s week is recorded.
            </Hint>
          </section>
          <section id="recording" className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
            <GroupHeading>Recording & compliance (information)</GroupHeading>
            <Hint className="mt-2">Provider calls request recording. A recording appears on call detail only after the provider confirms it is available. Manually recorded calls may have no audio. Recording cannot be turned off here.</Hint>
          </section>
          <section id="compliance" className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
            <GroupHeading>Compliance (information)</GroupHeading>
            <Hint className="mt-2">No compliance controls are configurable here yet.</Hint>
          </section>
        </div>
 );
}
