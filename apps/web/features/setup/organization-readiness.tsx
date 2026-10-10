'use client';

import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, ListChecks } from 'lucide-react';
import { Progress } from '@gold/ui/components/progress';
import { Button, ButtonLink } from '@/components/controls/button';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerFooter,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import { DividedList, GroupHeading } from '@/components/surfaces/section';
import { Badge } from '@/components/display/data';
import type { SetupArea, SetupImportance, SetupOverview } from '@/lib/domain/tenancy/lifecycle';

function countLabel(count: number, label: string): string {
  return `${count} ${label}${count === 1 ? '' : 's'}`;
}

function summary(overview: SetupOverview): { title: string; detail: string } {
  if (overview.blockers.length > 0) {
    return {
      title: 'Setup required',
      detail: `${countLabel(overview.blockers.length, 'required item')} must be completed before setup can be finished.`,
    };
  }

  const remaining = [
    overview.recommendedOpen ? countLabel(overview.recommendedOpen, 'recommendation') : null,
    overview.optionalOpen ? countLabel(overview.optionalOpen, 'optional capability') : null,
  ].filter(Boolean);

  return {
    title: 'Ready to operate',
    detail: remaining.length > 0 ? `${remaining.join(' and ')} remain.` : 'Organization setup is complete.',
  };
}

const IMPORTANCE_LABEL: Record<SetupImportance, string> = {
  required: 'Required',
  recommended: 'Recommended',
  optional: 'Optional',
};

function ReadinessGroup({ importance, areas }: { importance: SetupImportance; areas: SetupArea[] }) {
  const rows = areas.filter((area) => area.state === 'incomplete' && area.importance === importance);
  if (rows.length === 0) return null;

  return (
    <section>
      <GroupHeading>{IMPORTANCE_LABEL[importance]}</GroupHeading>
      <DividedList className="mt-2">
        {rows.map((area) => (
          <li key={area.key} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">{area.label}</p>
              <p className="mt-0.5 text-sm text-muted">{area.message}</p>
            </div>
            <ButtonLink href={area.area.href} size="small" className="shrink-0">
              Configure
            </ButtonLink>
          </li>
        ))}
      </DividedList>
    </section>
  );
}

export function OrganizationReadiness({
  organizationId,
  organizationName,
  overview,
  agentAvailable,
  finishAction,
}: {
  organizationId: string;
  organizationName: string;
  overview: SetupOverview;
  agentAvailable: boolean;
  finishAction?: ReactNode;
}) {
  const state = summary(overview);
  const percent = overview.total === 0 ? 100 : Math.round((overview.ready / overview.total) * 100);

  return (
    <PageDrawer>
      <section aria-labelledby="organization-readiness-heading" className="rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-secondary">
              {overview.blockers.length > 0 ? <ListChecks aria-hidden className="size-5" /> : <CheckCircle2 aria-hidden className="size-5 text-success" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="organization-readiness-heading" className="font-semibold">{organizationName} setup</h2>
                <Badge tone={overview.blockers.length > 0 ? 'neutral' : 'success'}>{state.title}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{state.detail}</p>
            </div>
          </div>
          <PageDrawerTrigger asChild>
            <Button tone="secondary" size="small">View setup <ArrowRight aria-hidden /></Button>
          </PageDrawerTrigger>
        </div>
      </section>

      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>Organization readiness</PageDrawerTitle>
          <PageDrawerDescription>{state.title}. {state.detail}</PageDrawerDescription>
        </PageDrawerHeader>
        <div className="space-y-6">
          <section aria-label="Setup progress">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{overview.blockers.length === 0 ? 'No required items outstanding' : countLabel(overview.blockers.length, 'required item') + ' outstanding'}</span>
            </div>
            <p className="mt-1 text-sm tabular-nums text-muted">{overview.ready} of {overview.total} setup areas ready, including recommended and optional ones</p>
            <Progress value={percent} className="mt-2" aria-label={`${overview.ready} of ${overview.total} setup areas ready, including optional areas`} />
          </section>
          <ReadinessGroup importance="required" areas={overview.areas} />
          <ReadinessGroup importance="recommended" areas={overview.areas} />
          <ReadinessGroup importance="optional" areas={overview.areas} />
          {overview.areas.every((area) => area.state === 'complete') ? (
            <p className="text-sm text-muted">Every setup area is ready. Configuration remains available in Settings and each workspace.</p>
          ) : null}
          {agentAvailable ? (
            <section className="border-t border-border pt-5">
              <p className="font-medium">Agent-assisted setup</p>
              <p className="mt-1 text-sm text-muted">Describe how the business works, review the proposed configuration, and apply only what is approved.</p>
              <ButtonLink href={`/organizations/${organizationId}/setup#agent-setup`} className="mt-3" size="small">
                Open Agent-assisted setup
              </ButtonLink>
            </section>
          ) : null}
        </div>
        {finishAction ? <PageDrawerFooter>{finishAction}</PageDrawerFooter> : null}
      </PageDrawerContent>
    </PageDrawer>
  );
}
