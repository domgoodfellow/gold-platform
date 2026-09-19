import { ButtonLink } from '@/components/controls/button';
import { AppPage } from '@/components/containers/app-page';
import { Card } from '@/components/containers/card';
import { ConfigureRegistrar } from '@/components/containers/configure-registrar';
import { DatePicker } from '@/components/controls/date-picker';
import { Toolbar } from '@/components/display/data';
import { Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/containers/page-header';
import { ConfigureTrigger } from '@/components/containers/workspace-right-rail';
import { DividedList, EmptyState, SectionHeading } from '@/components/containers/section';
import Link from 'next/link';
import { ScheduleConfiguration } from '@/features/scheduling/configuration/schedule-configuration';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { listOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { formatWindow, todayInZone, zonedDayRange } from '@/lib/domain/scheduling/window';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';

export const dynamic = 'force-dynamic';

/**
 * The calendar, which `domain-model.md` insists is a view rather than an entity:
 *
 *   > It is Work Items organised by time and resource, which is the scheduling core reading
 *   > its own rows back. A `calendar` table would be a second place a scheduled thing could
 *   > live, and the two would disagree the first time one was written without the other.
 *
 * So there is no calendar table, no cached day, and no denormalised slot. Everything on this
 * page is derived on read from `work_items`, and the free time is `freeWindows` — the one
 * availability calculation (I5), whose answer is advisory (I6) and is re-asserted by the
 * exclusion constraint when a dispatcher actually commits.
 */
export default async function SchedulePage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/schedule'>) {
  const { organizationId } = await params;
  const { on } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  // Which day, as this business reads a day — not as the server does. A tenant in Auckland
  // and one in Los Angeles are on different dates for most of the server's day.
  const requested = typeof on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null;
  const date = requested ?? todayInZone(organization.timezone);
  const within = zonedDayRange(date, organization.timezone);

  const mayConfigure = organization.capabilities.includes('field.manage');

  // `on` is what lets the calculation subtract this business's opening hours. Given together
  // because an hours rule is a recurring local reading and needs both to become instants.
  const [schedule, hours] = await Promise.all([
    listSchedule(db, { organizationId, within, on: { date, timeZone: organization.timezone } }),
    mayConfigure ? listOperatingHours(db, { organizationId }) : Promise.resolve([]),
  ]);

  const shift = (days: number) => {
    const moved = new Date(`${date}T00:00:00Z`);
    moved.setUTCDate(moved.getUTCDate() + days);
    return moved.toISOString().slice(0, 10);
  };
  const dayHref = (isoValue: string) => `/organizations/${organizationId}/schedule?on=${isoValue}`;

  return (
    <AppPage width="full">
      {mayConfigure ? (
        <ConfigureRegistrar
          title="Schedule configuration"
          settingsHref={`/organizations/${organizationId}/schedule/configuration`}
        >
          <ScheduleConfiguration
            organizationId={organizationId}
            role={organization.role}
            mayConfigure={mayConfigure}
            hours={hours}
            timezone={organization.timezone}
          />
        </ConfigureRegistrar>
      ) : null}

      {/* I9: every window below is an absolute instant rendered in this business's own
          zone, so naming the zone is part of reading the day rather than decoration. */}
      <PageHeader
        title={areaLabel('schedule')}
        description={
          <>
            Times shown in {organization.timezone} ·{' '}
            <Link
              href={`/organizations/${organizationId}/schedule/configuration`}
              className="underline underline-offset-4"
            >
              Opening hours
            </Link>
          </>
        }
        actions={mayConfigure ? <ConfigureTrigger /> : null}
      />

      {/* **A day is picked, not scrolled to.** Previous and Next were the whole of it, so
          getting to next Tuesday was six clicks and getting back to today was counting.
          *Today* is the one destination that is always worth a single control on a screen
          about days. */}
      <Toolbar aria-label="Day">
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={dayHref(shift(-1))} size="small">
            ← Previous
          </ButtonLink>
          <DatePicker
            value={date}
            basePath={`/organizations/${organizationId}/schedule`}
            param="on"
            label="Show this day"
          />
          <ButtonLink href={dayHref(shift(1))} size="small">
            Next →
          </ButtonLink>
        </div>

        {date === todayInZone(organization.timezone) ? null : (
          <Link
            href={`/organizations/${organizationId}/schedule`}
            className="text-sm underline underline-offset-4"
          >
            Back to today
          </Link>
        )}
      </Toolbar>

      {schedule.length === 0 ? (
        <EmptyState className="mt-6">
          Nothing to schedule against yet. A resource is whoever or whatever work occupies for
          a window — a technician, a van, a machine.
        </EmptyState>
      ) : (
        /* One card per resource, laid out by the space available rather than by a breakpoint:
           a business with two vans gets two columns on a laptop and one on a phone, and a
           business with nine gets three, with nothing here deciding which. */
        <div className="mt-6 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(20rem,1fr))]">
          {schedule.map((entry) => (
            <Card key={entry.resource.id} className="flex flex-col">
              <SectionHeading>{entry.resource.name}</SectionHeading>

              {entry.booked.length === 0 ? (
                <EmptyState weight="subtle" className="mt-2">Nothing booked.</EmptyState>
              ) : (
                <DividedList className="mt-2">
                  {entry.booked.map((booking) => (
                    <li key={booking.workItemId} className="py-2">
                      {/* **The job is a link now, and it was not.** A dispatcher looking at a
                          booked window is one step from wanting the job it belongs to, and
                          reaching it meant going to Work and finding it by name. */}
                      <Link
                        href={`/organizations/${organizationId}/work/${booking.workItemId}`}
                        className="font-medium underline underline-offset-4"
                      >
                        {booking.title}
                      </Link>
                      <div className="text-sm tabular-nums text-muted">
                        {formatWindow(booking.window, organization.timezone)}
                      </div>
                    </li>
                  ))}
                </DividedList>
              )}

              {/* Advisory, and labelled as such, because it is (I6). By the time anyone acts on
                  it the world may have moved; the exclusion constraint is what decides. */}
              {/* Free time is what the business is open for, minus what is committed. With no
                  opening hours set that is the whole day — "no claim" rather than "closed". */}
              <Hint weight="subtle" className="mt-3 border-t border-border pt-2">
                Free (advisory):{' '}
                {entry.free.length === 0
                  ? 'nothing left today'
                  : entry.free
                      .map((window) => formatWindow(window, organization.timezone))
                      .join(' · ')}
              </Hint>
            </Card>
          ))}
        </div>
      )}

    </AppPage>
  );
}
