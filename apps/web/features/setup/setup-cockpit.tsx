import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleDashed } from 'lucide-react';
import { Progress } from '@gold/ui/components/progress';
import { Card } from '@/components/containers/card';
import { DividedList, SectionHeading } from '@/components/containers/section';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import type { SetupArea, SetupOverview } from '@/lib/domain/tenancy/lifecycle';

/**
 * The setup cockpit's presentation. It renders the answer `computeSetupOverview` gives and decides
 * nothing: which area exists, whether it blocks and where it is configured all arrive in the
 * data, and every row links to the workspace that owns that configuration rather than holding a
 * second copy of its form. Server components throughout — `LaunchForm` is the one interactive
 * piece and the route passes it in.
 */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Areas finished out of areas listed — a semantic count first; the bar only echoes it. */
export function SetupProgressCard({ overview }: { overview: SetupOverview }) {
  if (overview.total === 0) return null;
  const percent = Math.round((overview.ready / overview.total) * 100);

  return (
    <Card as="section" aria-labelledby="setup-progress-heading">
      <SectionHeading id="setup-progress-heading">Progress</SectionHeading>
      <p className="mt-1 text-sm">
        <span className="font-medium tabular-nums">
          {overview.ready} of {overview.total}
        </span>{' '}
        setup areas ready
      </p>
      <Progress
        value={percent}
        // The primitive's track is shadcn's `bg-muted`, which is this system's text role; the rule colour is the track.
        className="mt-3 bg-border"
        aria-label={`${overview.ready} of ${overview.total} setup areas ready`}
      />
    </Card>
  );
}

/** The two words a row carries — importance and state — so nothing depends on colour or an icon alone. */
function areaStatus(area: SetupArea): { label: string; icon: ReactNode; tone: 'accent' | 'success' | 'neutral' } {
  if (area.state === 'complete') {
    return { label: 'Ready', icon: <CircleCheck aria-hidden className="size-4" />, tone: 'success' };
  }
  switch (area.importance) {
    case 'required':
      return { label: 'Blocks launch', icon: <CircleAlert aria-hidden className="size-4" />, tone: 'accent' };
    case 'recommended':
      return { label: 'Recommended', icon: <CircleDashed aria-hidden className="size-4" />, tone: 'neutral' };
    case 'optional':
      return { label: 'Optional', icon: <CircleDashed aria-hidden className="size-4" />, tone: 'neutral' };
  }
}

export function SetupAreaList({ areas }: { areas: SetupArea[] }) {
  return (
    <Card as="section" aria-labelledby="setup-areas-heading">
      <SectionHeading id="setup-areas-heading">Areas</SectionHeading>
      <DividedList className="mt-2">
        {areas.map((area) => {
          const status = areaStatus(area);
          return (
            <li key={area.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{area.label}</span>
                  <Badge tone={status.tone} className="gap-1">
                    {status.icon}
                    {status.label}
                  </Badge>
                </div>
                <p className="mt-0.5 text-sm text-muted">{area.message}</p>
              </div>
              <ButtonLink href={area.area.href} tone="secondary" size="small">
                {area.state === 'complete' ? `Open ${area.area.label}` : `Configure ${area.area.label}`}
              </ButtonLink>
            </li>
          );
        })}
      </DividedList>
    </Card>
  );
}

/**
 * Launch as a review boundary. With a blocker standing there is no button at all — the reasons
 * and where to clear them are the content, so nothing is a disabled control with no explanation.
 * The page is not the integrity boundary: `launchOrganization` and the database trigger re-check
 * regardless of what this rendered.
 */
export function LaunchReview({
  overview,
  launch,
}: {
  overview: SetupOverview;
  /** The interactive Launch control, or the sentence saying this role cannot use it. */
  launch: ReactNode;
}) {
  const blocked = overview.blockers.length > 0;

  return (
    <Card as="section" aria-labelledby="setup-launch-heading">
      <SectionHeading id="setup-launch-heading">Review &amp; launch</SectionHeading>

      {blocked ? (
        <>
          <p className="mt-1 text-sm">
            {plural(overview.blockers.length, 'required area blocks', 'required areas block')} launch.
          </p>
          <DividedList className="mt-2">
            {overview.blockers.map((area) => (
              <li key={area.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-0 flex-1 basis-64">
                  <span className="font-medium">{area.label}.</span> {area.message}
                </span>
                <ButtonLink href={area.area.href} tone="text" size="small">
                  Configure {area.area.label}
                </ButtonLink>
              </li>
            ))}
          </DividedList>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm">Nothing blocks launch.</p>
          <dl className="mt-3 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Required setup</dt>
            <dd>Complete</dd>
            <dt className="text-muted">Recommendations</dt>
            <dd>{overview.recommendedOpen === 0 ? 'None unfinished' : `${overview.recommendedOpen} unfinished`}</dd>
            <dt className="text-muted">Optional areas</dt>
            <dd>{overview.optionalOpen === 0 ? 'None unfinished' : `${overview.optionalOpen} unfinished`}</dd>
          </dl>
          <Hint className="mt-3">
            Launching makes Today the default workspace for this business. Every area above stays
            configurable from Settings.
          </Hint>
          <div className="mt-4">
            {launch}
          </div>
        </>
      )}
    </Card>
  );
}
