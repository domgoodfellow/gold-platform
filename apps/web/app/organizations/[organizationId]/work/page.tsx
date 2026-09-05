import { Hint } from '@/components/controls/inputs';
import { Card, Disclosure } from '@/components/containers/card';
import { Badge } from '@/components/display/data';
import { DividedList, EmptyState, Section, SectionHeading } from '@/components/containers/section';
import Link from 'next/link';
import { CustomFieldValues } from '@/components/custom-fields/values';
import { listAssets } from '@/lib/domain/assets/assets';
import { listCustomers } from '@/lib/domain/customers/customers';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listLocations } from '@/lib/domain/locations/locations';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { listResources } from '@/lib/domain/resources/resources';
import { listEnabledModules } from '@/lib/domain/tenancy/modules';
import { formatWindow } from '@/lib/domain/scheduling/window';
import { listTypeChecklistItems } from '@/lib/domain/work-items/checklists';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import {
  allowedNextStatusIds,
  listWorkItemTransitions,
} from '@/lib/domain/work-items/transitions';
import { getTypeBooking, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { listWorkItems, type WorkItem } from '@/lib/domain/work-items/work-items';
import { counted } from '@/lib/domain/counted';
import { requireOrganization } from '@/lib/route/organization';
import {
  AddTypeChecklistItemForm,
  CreateStatusForm,
  CreateTransitionForm,
  CreateTypeForm,
  CreateWorkItemForm,
  EditStatusForm,
  MoveWorkItemForm,
  PublishTypeForm,
  RenameTypeForm,
  ScheduleWorkItemForm,
  TypeChecklistItemRow,
} from './work-forms';

export const dynamic = 'force-dynamic';

export default async function WorkPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/work'>) {
  const { organizationId } = await params;
  const { type: requestedType } = await searchParams;
  const { db, organization } = await requireOrganization(organizationId);

  const types = await listWorkItemTypes(db, { organizationId });

  // Which board is on screen is a route parameter and nothing more. An unknown or absent id
  // falls back to the first type rather than erroring: RLS has already decided which types
  // exist here, so a value that matches none of them is a stale link, not an intrusion.
  const selectedType = types.find((type) => type.id === requestedType) ?? types[0] ?? null;

  const [
    statuses,
    transitions,
    templateSteps,
    workItems,
    customers,
    locations,
    resources,
    assets,
    definitions,
    prices,
    booking,
    enabledModules,
  ] = await Promise.all([
      selectedType
        ? listWorkItemStatuses(db, { organizationId, typeId: selectedType.id })
        : Promise.resolve([]),
      selectedType
        ? listWorkItemTransitions(db, { organizationId, typeId: selectedType.id })
        : Promise.resolve([]),
      selectedType
        ? listTypeChecklistItems(db, { organizationId, typeId: selectedType.id })
        : Promise.resolve([]),
      selectedType
        ? listWorkItems(db, { organizationId, typeId: selectedType.id })
        // An empty page rather than a bare array, so *no kind of work selected* and *this kind
        // has no work* are the same shape to everything downstream — including the line that
        // says how much of the list is on screen.
        : Promise.resolve(counted([] as WorkItem[], 0)),
      listCustomers(db, { organizationId }),
      listLocations(db, { organizationId }),
      listResources(db, { organizationId }),
      listAssets(db, { organizationId }),
      listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
      listPriceBookItems(db, { organizationId }),
      selectedType
        ? getTypeBooking(db, { organizationId, typeId: selectedType.id })
        : Promise.resolve(null),
      listEnabledModules(db, { organizationId }),
    ]);

  const mayAdd = organization.capabilities.includes('work_item.create');
  const mayConfigure = organization.capabilities.includes('field.manage');
  const bookingEnabled = enabledModules.has('booking');
  const mayMove = organization.capabilities.includes('work_item.transition');
  const maySchedule = organization.capabilities.includes('work_item.schedule');

  const resourceOptions = resources.map((r) => ({ id: r.id, label: r.name }));

  // Names for the ids a transition holds. The board renders the tenant's words; the database
  // holds only uuids, which is why the domain layer re-checks a refused move to build the
  // message rather than letting the trigger's text reach a person.
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));

  return (
    <>
      {/* The tenant's own kinds of work, in their own words. Nothing here branches on which
          one is selected — a different type is a different set of columns, not a different
          screen. */}
      {types.length > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Work item type">
          {types.map((type) => {
            const current = type.id === selectedType?.id;
            return (
              <Link
                key={type.id}
                href={`/organizations/${organizationId}/work?type=${type.id}`}
                aria-current={current ? 'page' : undefined}
                className={
                  current
                    ? 'rounded bg-foreground px-3 py-1 text-sm text-background'
                    : 'rounded border border-border px-3 py-1 text-sm '
                }
              >
                {type.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {/* **The board is one page of the work, and says so when it is not all of it.** Every
          other list on this surface gets this from `DataTable`; a board of cards grouped by
          status has to say it itself, and it is the list most likely to need to — a business
          doing ten jobs a day passes five hundred inside two months. */}
      {workItems.total > workItems.length ? (
        <Hint weight="subtle" className="mt-4">
          Showing the {workItems.length} most recent of {workItems.total} in this kind of work.
        </Hint>
      ) : null}

      {selectedType === null ? (
        <EmptyState className="mt-6">
          No kinds of work defined yet. What this business does is yours to name — the
          platform has no opinion.
        </EmptyState>
      ) : (
        <>
          {/* Grouped by this type's own statuses, in the tenant's own order (D6). */}
          {statuses.map((status) => {
            const inStatus = workItems.filter((item) => item.status.id === status.id);
            return (
              <section key={status.id} className="mt-6">
                <SectionHeading>
                  {status.name}
                  <span className="ml-2 text-subtle">{inStatus.length}</span>
                </SectionHeading>

                {inStatus.length === 0 ? (
                  <EmptyState weight="subtle" className="mt-1">Nothing here.</EmptyState>
                ) : (
                  /* **A card per job, and the actions in a footer.** Every row used to render
                      two whole forms — two datetime fields, a select and four buttons — so a
                      status holding ten jobs was forty controls and the jobs themselves were
                      whatever was left between them. What a person does most is move a job on,
                      so that stays visible as one row of buttons; scheduling is several fields
                      and is done once per job, so it is available rather than permanent. */
                  <ul className="mt-2 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(19rem,1fr))]">
                    {inStatus.map((item) => (
                      <li key={item.id}>
                        <Card className="flex h-full flex-col">
                          <Link
                            href={`/organizations/${organizationId}/work/${item.id}`}
                            className="font-medium underline underline-offset-4"
                          >
                            {item.title}
                          </Link>

                          {/* I9: the instant is absolute in the database and is rendered in
                              the organization's zone, never the server's or the reader's. A job
                              with no window says so, because *unscheduled* is exactly what
                              somebody scanning this board is looking for. */}
                          <div className="mt-1 text-sm">
                            {item.window ? (
                              <span className="tabular-nums text-muted">
                                {formatWindow(item.window, organization.timezone)}
                              </span>
                            ) : (
                              <span className="text-subtle">Not scheduled</span>
                            )}
                          </div>

                          {item.customer || item.location || item.asset || item.resource ? (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {[item.customer?.label, item.location?.label, item.asset?.label]
                                .filter(Boolean)
                                .map((label) => (
                                  <Badge key={label}>{label}</Badge>
                                ))}
                              {/* The tenant's own colour, saying *this one* — who is on a job
                                  is what a dispatcher scans a board for. Never *this one is
                                  good*: §7 is about meaning, and an assignment has none. */}
                              {item.resource ? (
                                <Badge tone="accent">{item.resource.label}</Badge>
                              ) : null}
                            </div>
                          ) : null}

                          <CustomFieldValues definitions={definitions} custom={item.custom} />

                          {mayMove || maySchedule ? (
                            <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                              {mayMove ? (
                                <MoveWorkItemForm
                                  organizationId={organizationId}
                                  workItemId={item.id}
                                  moves={allowedNextStatusIds(transitions, item.status.id).flatMap(
                                    (id) => {
                                      const name = statusName.get(id);
                                      return name ? [{ id, name }] : [];
                                    },
                                  )}
                                />
                              ) : null}
                              {maySchedule ? (
                                <Disclosure
                                  summary={item.window ? 'Reschedule' : 'Schedule'}
                                  className="border-0"
                                >
                                  <ScheduleWorkItemForm
                                    organizationId={organizationId}
                                    workItemId={item.id}
                                    resources={resourceOptions}
                                    scheduled={item.window !== null}
                                  />
                                </Disclosure>
                              ) : null}
                            </div>
                          ) : null}
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {/*
            Hiding either form is a courtesy, not the guard. `work_items_insert` requires
            work_item.create and both `work_item_statuses_insert` and `work_item_types_insert`
            require field.manage, all in the database (constraints.md: hiding a UI element is
            not authorization).
          */}
          {mayAdd ? (
            <CreateWorkItemForm
              organizationId={organizationId}
              statuses={statuses}
              customers={customers.map((c) => ({ id: c.id, label: c.name }))}
              locations={locations.map((l) => ({ id: l.id, label: l.label }))}
              resources={resourceOptions}
              assets={assets.map((a) => ({ id: a.id, label: a.name }))}
              definitions={definitions}
            />
          ) : (
            <Hint className="mt-8">
              Your role, {organization.role}, cannot add work items here.
            </Hint>
          )}

          <Section className="mt-10">
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

          {/* **A module hides what it owns everywhere, not only its own area.** Switching public
              booking off takes this section away for the same reason switching billing off takes
              the quote off a job: hiding the area and leaving its controls scattered across other
              screens is half a switch. The public address itself is configured in Settings, which
              is where the module says it is set up — this is the per-type half of the same
              thing, and `outstandingModuleSetup` now names both. */}
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
                // Shown to everybody and refused by the database if their role cannot configure
                // types — I12's rule, and the same one every other form on this page follows.
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
