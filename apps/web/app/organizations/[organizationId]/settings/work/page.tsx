import { DividedList, EmptyState, PageHeading, Section, SectionHeading } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import Link from 'next/link';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTransitions } from '@/lib/domain/work-items/transitions';
import { getTypeBooking, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { requireOrganization } from '@/lib/route/organization';
import {
  AddTypeChecklistItemForm,
  CreateStatusForm,
  CreateTransitionForm,
  CreateTypeForm,
  EditStatusForm,
  PublishTypeForm,
  RenameTypeForm,
  TypeChecklistItemRow,
} from './work-config-forms';

export const dynamic = 'force-dynamic';

/**
 * How work behaves, apart from doing it.
 *
 * Moved out of the operational Work screen (product reality audit, Slice 3): a business scanning
 * today's jobs should not have to scroll past what a status means to reach them, and naming a new
 * kind of work is closer to Settings than to today's shift. Nothing here is a new calculation or
 * a new write path — every form is the one that always wrote these rows, just reached from where
 * defining a business now lives.
 *
 * A detail route under Settings rather than an area of its own: `AreaTrail` already renders the
 * "‹ Settings" link for anything this deep, so this page writes its own heading the same way a
 * job's own page does (`ui-spec.md` — no heading on an area page, and this is not one).
 */
export default async function WorkConfigurationPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/settings/work'>) {
  const { organizationId } = await params;
  const { type: requestedType } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  const types = await listWorkItemTypes(db, { organizationId });
  const selectedType = types.find((type) => type.id === requestedType) ?? types[0] ?? null;

  const [statuses, transitions, templateSteps, prices, booking, enabledModules] = await Promise.all([
    selectedType
      ? listWorkItemStatuses(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve([]),
    selectedType
      ? listWorkItemTransitions(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve([]),
    selectedType
      ? listTypeChecklistItems(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve([]),
    listPriceBookItems(db, { organizationId }),
    selectedType
      ? getTypeBooking(db, { organizationId, typeId: selectedType.id })
      : Promise.resolve(null),
    listEnabledModules(db, { organizationId }),
  ]);

  const mayConfigure = organization.capabilities.includes('field.manage');
  const bookingEnabled = enabledModules.has('booking');
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));

  return (
    <>
      <PageHeading>Work</PageHeading>
      <Hint className="mt-1">
        The kinds of work this business does, the stages a job moves through, and the steps every
        job of a kind involves.{' '}
        <Link
          href={`/organizations/${organizationId}/work`}
          className="underline underline-offset-4"
        >
          Doing today&rsquo;s work
        </Link>{' '}
        happens on its own screen; this is where its shape is defined.
      </Hint>

      {types.length > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Kind of work">
          {types.map((type) => {
            const current = type.id === selectedType?.id;
            return (
              <Link
                key={type.id}
                href={`/organizations/${organizationId}/settings/work?type=${type.id}`}
                aria-current={current ? 'page' : undefined}
                className={
                  current
                    ? 'rounded bg-foreground px-3 py-1 text-sm text-background'
                    : 'rounded border border-border px-3 py-1 text-sm'
                }
              >
                {type.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {selectedType === null ? (
        <EmptyState className="mt-6">
          No kinds of work defined yet. What this business does is yours to name — the platform
          has no opinion.
        </EmptyState>
      ) : (
        <>
          <Section className="mt-8">
            <SectionHeading>{selectedType.name} statuses</SectionHeading>
            <Hint className="mt-1">
              {statuses.length === 0
                ? 'None yet. These are yours to name — the platform has no opinion.'
                : statuses.map((status) => status.name).join(' → ')}
            </Hint>

            {mayConfigure && statuses.length > 0 ? (
              <DividedList as="div" className="mt-3">
                {statuses.map((status) => (
                  <EditStatusForm
                    key={status.id}
                    organizationId={organizationId}
                    status={status}
                  />
                ))}
              </DividedList>
            ) : null}

            {mayConfigure ? (
              <CreateStatusForm organizationId={organizationId} typeId={selectedType.id} />
            ) : (
              <Hint className="mt-2">
                Your role, {organization.role}, cannot configure statuses here.
              </Hint>
            )}
          </Section>

          <Section className="mt-10">
            <SectionHeading>Allowed moves</SectionHeading>
            {/* An unconfigured type is frozen, not unconstrained — I13 has exactly one
                reading when a tenant has configured no transitions at all. Saying so here is
                the difference between a board that looks broken and one that is unfinished. */}
            <Hint className="mt-1">
              {transitions.length === 0
                ? 'None yet, so nothing on this board can move. Wire the moves this business actually makes.'
                : transitions
                    .map(
                      (transition) =>
                        `${statusName.get(transition.fromStatusId) ?? '?'} → ${
                          statusName.get(transition.toStatusId) ?? '?'
                        }`,
                    )
                    .join(' · ')}
            </Hint>

            {mayConfigure ? (
              <CreateTransitionForm
                organizationId={organizationId}
                typeId={selectedType.id}
                statuses={statuses}
              />
            ) : (
              <Hint className="mt-2">
                Your role, {organization.role}, cannot configure transitions here.
              </Hint>
            )}
          </Section>

          <Section className="mt-10">
            <SectionHeading>Steps every {selectedType.name} involves</SectionHeading>
            {/* Copied onto each job at creation, never joined. Editing this list does not
                reach a job that already exists — which is what makes editing it safe (I8). */}
            <Hint className="mt-1">
              {templateSteps.length === 0
                ? 'None. Work items of this kind start with an empty checklist.'
                : 'Copied onto each new work item. Changing them leaves existing work alone.'}
            </Hint>

            {templateSteps.length > 0 ? (
              <DividedList as="div" className="mt-2">
                {templateSteps.map((item) =>
                  mayConfigure ? (
                    <TypeChecklistItemRow
                      key={item.id}
                      organizationId={organizationId}
                      item={item}
                    />
                  ) : (
                    <Hint key={item.id} className="py-1">
                      {item.label}
                    </Hint>
                  ),
                )}
              </DividedList>
            ) : null}

            {mayConfigure ? (
              <AddTypeChecklistItemForm
                organizationId={organizationId}
                typeId={selectedType.id}
              />
            ) : null}
          </Section>

          {/* A module hides what it owns everywhere, not only its own area — publishing a type
              is the per-type half of public booking, and the address itself stays configured in
              Settings' own public-page section (`outstandingModuleSetup` names both). */}
          {bookingEnabled ? (
            <Section className="mt-10">
              <SectionHeading>Publish to the public booking page</SectionHeading>
              <PublishTypeForm
                organizationId={organizationId}
                typeId={selectedType.id}
                typeName={selectedType.name}
                statuses={statuses}
                prices={prices}
                booking={booking}
                disabled={!mayConfigure}
              />
              {!mayConfigure ? (
                <Hint className="mt-2">
                  Your role, {organization.role}, cannot change what this business publishes.
                </Hint>
              ) : null}
            </Section>
          ) : null}

          {mayConfigure ? (
            <Section className="mt-10">
              <SectionHeading>Rename this kind of work</SectionHeading>
              <RenameTypeForm
                organizationId={organizationId}
                typeId={selectedType.id}
                name={selectedType.name}
              />
            </Section>
          ) : null}
        </>
      )}

      <Section className="mt-10">
        <SectionHeading>Kinds of work</SectionHeading>
        <Hint className="mt-1">
          {types.length === 0
            ? 'None yet. A type is what scopes a board — statuses belong to one.'
            : types.map((type) => type.name).join(' · ')}
        </Hint>

        {mayConfigure ? (
          <CreateTypeForm organizationId={organizationId} />
        ) : (
          <Hint className="mt-2">
            Your role, {organization.role}, cannot configure work item types here.
          </Hint>
        )}
      </Section>
    </>
  );
}
