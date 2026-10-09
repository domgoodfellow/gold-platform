import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { ButtonLink } from '@/components/controls/button';
import { Badge } from '@/components/display/data';
import { Card } from '@/components/surfaces/card';
import { FOCUS_RING } from '@/components/class-names';
import { setupStepHref, type SetupStep } from './setup-guide';
import type { SetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { LaunchReview, SetupProgressCard } from './setup-cockpit';
import { SetupStepNavigation } from './setup-step-navigation';

export function GuidedSetup({ organizationId, steps, selected, overview, business, handoff, launch, live }: {
  organizationId: string; steps: SetupStep[]; selected: SetupStep; overview: SetupOverview;
  business: ReactNode; handoff: ReactNode; launch: ReactNode; live: boolean;
}) {
  const index = steps.findIndex((step) => step.key === selected.key);
  const allowedDestinations = steps.flatMap((step) => step.destinations.map((entry) => `/organizations/${organizationId}/${entry.path}`));
  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,2.8fr)_minmax(0,1.6fr)]">
      <SetupStepNavigation organizationId={organizationId} steps={steps} selectedKey={selected.key} />
      <div className="min-w-0 space-y-5">
        <Card as="section" aria-labelledby="current-setup-step">
          <p className="text-xs text-muted">Step {index + 1} of {steps.length}</p>
          <h2 id="current-setup-step" className="mt-1 text-lg font-semibold">{selected.label}</h2>
          <p className="mt-1 text-sm text-muted">{selected.description}</p>
          {selected.key === 'business' ? business : null}
          {selected.key !== 'business' && selected.destinations.length ? <ul className="mt-4 divide-y divide-border">
            {selected.destinations.map((entry) => {
              const area = selected.areas.find((candidate) => candidate.area.href.split('#')[0] === `/organizations/${organizationId}/${entry.path}`);
              return <li key={entry.key} className="py-3">
                <Link href={`/organizations/${organizationId}/${entry.path}`} className={`${FOCUS_RING} flex items-start gap-3 rounded-md`}>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{entry.title}</span>
                    {area ? <Badge className="ml-2">{area.state === 'complete' ? 'Ready' : area.importance}</Badge> : null}
                    <p className="mt-1 text-sm text-muted">{area?.message ?? entry.description}</p>
                  </div><ChevronRight aria-hidden className="mt-1 size-4 shrink-0" />
                </Link>
              </li>;
            })}
          </ul> : null}
          {selected.key === 'review' ? <div className="mt-4 space-y-3">
            <p className="text-sm">{overview.blockers.length ? `${overview.blockers.length} required conditions remain.` : 'All required launch conditions are satisfied.'} Recommendations and optional areas do not prevent launch.</p>
            <ul className="divide-y divide-border">{overview.areas.map((area) => <li key={area.key} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{area.label}</span><Badge>{area.state === 'complete' ? 'Ready' : area.importance}</Badge></div>
              <p className="mt-1 text-muted">{area.message}</p>
              {allowedDestinations.includes(area.area.href.split('#')[0]) ? <ButtonLink href={area.area.href} tone="text" size="small" className="mt-1">Open {area.area.label}</ButtonLink> : area.state === 'incomplete' && area.importance === 'required' ? <p className="mt-1 text-muted">Ask an administrator to resolve this.</p> : null}
            </li>)}</ul>
          </div> : null}
          <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            {index > 0 ? <ButtonLink href={setupStepHref(organizationId, steps[index - 1].key)} tone="secondary" size="small">Back</ButtonLink> : <span />}
            {index < steps.length - 1 ? <ButtonLink href={setupStepHref(organizationId, steps[index + 1].key)} size="small">Continue</ButtonLink> : null}
          </div>
        </Card>
        {selected.key === 'business' ? handoff : null}
        <p className="text-xs text-muted">Progress reflects saved configuration. Continuing between steps does not mark anything complete.</p>
      </div>
      <aside aria-label="Organization readiness" className="min-w-0 space-y-4 lg:col-start-2 xl:col-start-auto">
        <SetupProgressCard overview={overview} />
        {live ? <Card><h2 className="text-sm font-medium">Organization is Live</h2><p className="mt-1 text-sm text-muted">You can revisit configuration whenever the business changes.</p><ButtonLink href={`/organizations/${organizationId}/home`} tone="secondary" size="small" className="mt-3">Open Home</ButtonLink></Card>
          : <LaunchReview overview={overview} launch={launch} allowedDestinations={allowedDestinations} />}
      </aside>
    </div>
  );
}
