import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { Progress } from '@gold/ui/components/progress';
import { Card } from '@/components/surfaces/card';
import { DividedList, SectionHeading } from '@/components/surfaces/section';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import type { SetupArea, SetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { configurationOwnerPath, withSetupContext } from '@/lib/route/setup-context';

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

/**
 * Two different questions, answered separately: what still *blocks* setup (required items only),
 * and how many of the listed areas are finished (which includes recommended and optional ones, so
 * it is never read as a launch score).
 */
export function SetupProgressCard({ overview }: { overview: SetupOverview }) {
  if (overview.total === 0) return null;
  const percent = Math.round((overview.ready / overview.total) * 100);
  const required = overview.blockers.length;
  const requiredLine = required === 0 ? 'No required items outstanding' : `${plural(required, 'required item', 'required items')} outstanding`;

  return (
    <Card as="section" aria-labelledby="setup-progress-heading">
      <SectionHeading id="setup-progress-heading">Progress</SectionHeading>
      <p className="mt-1 text-sm font-medium tabular-nums">{requiredLine}</p>
      <p className="mt-2 text-sm text-muted">
        <span className="tabular-nums">{overview.ready} of {overview.total}</span> setup areas ready, including recommended and optional ones
      </p>
      <Progress
        value={percent}
        className="mt-3"
        aria-label={`${overview.ready} of ${overview.total} setup areas ready, including optional areas`}
      />
    </Card>
  );
}

/** The two words a row carries — importance and state — so nothing depends on colour or an icon alone. */
function areaStatus(area: SetupArea): { label: string; icon?: ReactNode; tone: 'accent' | 'success' | 'neutral' } {
  if (area.state === 'complete') {
    return { label: 'Ready', icon: <CircleCheck aria-hidden className="size-4" />, tone: 'success' };
  }
  switch (area.importance) {
    case 'required':
      return { label: 'Required', icon: <CircleAlert aria-hidden className="size-4" />, tone: 'accent' };
    // The word carries the meaning; a dashed circle here read as a loading spinner.
    case 'recommended':
      return { label: 'Recommended', tone: 'neutral' };
    case 'optional':
      return { label: 'Optional', tone: 'neutral' };
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
              <ButtonLink
                href={area.area.href}
                tone="secondary"
                size="small"
                aria-label={`${area.state === 'complete' ? 'Open' : 'Set up'} ${area.area.label}`}
              >
                {area.state === 'complete' ? 'Open' : 'Set up'}
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
  allowedDestinations,
}: {
  overview: SetupOverview;
  /** The interactive Launch control, or the sentence saying this role cannot use it. */
  launch: ReactNode;
  allowedDestinations?: readonly string[];
}) {
  const blocked = overview.blockers.length > 0;

  return (
    <Card as="section" aria-labelledby="setup-launch-heading">
      <SectionHeading id="setup-launch-heading">Finish setup</SectionHeading>

      {blocked ? (
        <>
          <p className="mt-1 text-sm">
            {plural(overview.blockers.length, 'required area must', 'required areas must')} be completed first.
          </p>
          <DividedList className="mt-2">
            {overview.blockers.map((area) => (
              <li key={area.key} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
                <span className="min-w-0 flex-1 basis-64">
                  <span className="font-medium">{area.label}.</span> {area.message}
                </span>
                {!allowedDestinations || allowedDestinations.includes(configurationOwnerPath(area.area.href)) ? <ButtonLink href={withSetupContext(area.area.href, 'review')} tone="text" size="small" aria-label={`Set up ${area.area.label}`}>
                  Set up
                </ButtonLink> : <span className="text-xs text-muted">Ask an administrator to resolve this.</span>}
              </li>
            ))}
          </DividedList>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm">This organization is ready to operate.</p>
          <dl className="mt-3 grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-muted">Required setup</dt>
            <dd>Complete</dd>
            <dt className="text-muted">Recommendations</dt>
            <dd>{overview.recommendedOpen === 0 ? 'None unfinished' : `${overview.recommendedOpen} unfinished`}</dd>
            <dt className="text-muted">Optional areas</dt>
            <dd>{overview.optionalOpen === 0 ? 'None unfinished' : `${overview.optionalOpen} unfinished`}</dd>
          </dl>
          <Hint className="mt-3">
            Finishing setup makes Home the default workspace for this business.
          </Hint>
          <div className="mt-4">
            {launch}
          </div>
        </>
      )}
    </Card>
  );
}
