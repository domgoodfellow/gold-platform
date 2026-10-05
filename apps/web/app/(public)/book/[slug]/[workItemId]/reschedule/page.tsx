import { Hint } from '@/components/controls/inputs';
import { ButtonLink } from '@/components/controls/button';
import { EmptyState } from '@/components/surfaces/section';
import { notFound } from 'next/navigation';
import { getDb } from '@/lib/db/server';
import { PublicHeader } from '@/features/public-profile/public-header';
import { listBookableTypes, resolveBookingSlug } from '@/lib/domain/booking/booking';
import { getBookingChangeOptions, rescheduleSlots } from '@/lib/domain/booking/changes';
import {
  addCalendarDays,
  describeBookingPolicyReason,
  getEffectiveBookingPolicy,
  offerableDates,
} from '@/lib/domain/booking/policy';
import { publicProfile } from '@/lib/domain/tenancy/profile';
import { formatWindow, parseWindow, todayInZone } from '@/lib/domain/scheduling/window';
import { RescheduleSlots } from '../change-controls';

export const dynamic = 'force-dynamic';

/**
 * A customer choosing a new time for a booking of their own. The times are the public ones — the same
 * policy and feasibility as booking — with this booking's own time set aside, and the business's limits
 * are checked again by the database when the move is made.
 */
export default async function ReschedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; workItemId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, workItemId } = await params;
  const { on } = await searchParams;
  const db = await getDb();

  const organizationId = await resolveBookingSlug(db, slug);
  if (!organizationId) notFound();

  const [organization, item, options] = await Promise.all([
    db.from('organizations').select('name, timezone').eq('id', organizationId).maybeSingle(),
    db.from('work_items').select('type_id, scheduled_during').eq('id', workItemId).maybeSingle(),
    getBookingChangeOptions(db, { workItemId }),
  ]);
  if (!organization.data || !item.data || !options) notFound();

  const timeZone = organization.data.timezone;
  const profile = await publicProfile(db, { organizationId, fallbackName: organization.data.name });
  const back = `/book/${slug}/${workItemId}`;

  if (!options.canReschedule) {
    return (
      <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
        <PublicHeader profile={profile} />
        <p role="alert" className="mt-6 text-sm">
          {options.rescheduleRefusal ? describeBookingPolicyReason(options.rescheduleRefusal) : 'That cannot be changed online.'}
        </p>
        <ButtonLink tone="secondary" href={back} className="mt-4 w-fit">Back to my booking</ButtonLink>
      </main>
    );
  }

  const typeId = item.data.type_id;
  const type = (await listBookableTypes(db, { organizationId })).find((candidate) => candidate.id === typeId);
  const policy = await getEffectiveBookingPolicy(db, { organizationId, typeId });
  if (!type || !policy) notFound();

  const now = new Date();
  const range = offerableDates({ now, policy, timeZone });
  const today = todayInZone(timeZone, now);
  const requested = typeof on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(on) ? on : null;
  const current = parseWindow(item.data.scheduled_during as string | null);
  // Where a customer most likely wants to look: the day they already have, if it is still bookable.
  const own = current ? todayInZone(timeZone, new Date(current.startsAt)) : null;
  const fallback = own && own >= range.first && own <= range.last ? own : today > range.first ? today : range.first;
  const date = requested ?? fallback;
  const slots = await rescheduleSlots(db, { organizationId, workItemId, type, date, timeZone, now });
  const day = new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeZone }).format(new Date(`${date}T12:00:00Z`));

  return (
    <main className="mx-auto w-full max-w-xl p-6 sm:p-8">
      <PublicHeader profile={profile} />
      <h1 className="mt-6 text-base font-medium">Choose a new time</h1>
      {current ? <Hint>Now: {formatWindow(current, timeZone)}</Hint> : null}
      <nav aria-label="Choose a day" className="mt-4 flex items-center justify-between gap-2">
        {date > range.first ? (
          <ButtonLink tone="secondary" size="small" href={`${back}/reschedule?on=${addCalendarDays(date, -1)}`}>Previous day</ButtonLink>
        ) : <span aria-hidden />}
        <Hint>{day}</Hint>
        {date < range.last ? (
          <ButtonLink tone="secondary" size="small" href={`${back}/reschedule?on=${addCalendarDays(date, 1)}`}>Next day</ButtonLink>
        ) : <span aria-hidden />}
      </nav>
      {slots.length === 0 ? (
        <EmptyState weight="subtle" className="mt-3">Nothing free on this day.</EmptyState>
      ) : (
        <RescheduleSlots slug={slug} workItemId={workItemId} slots={slots} timeZone={timeZone} />
      )}
      <ButtonLink tone="text" href={back} className="mt-6 w-fit">Keep my current time</ButtonLink>
    </main>
  );
}
