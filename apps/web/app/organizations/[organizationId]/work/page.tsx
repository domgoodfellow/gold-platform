import Link from 'next/link';
import { CustomFieldValues } from '@/components/custom-field-values';
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
import { listWorkItems } from '@/lib/domain/work-items/work-items';
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
        : Promise.resolve([]),
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
                    : 'rounded border border-black/15 px-3 py-1 text-sm dark:border-white/20'
                }
              >
                {type.name}
              </Link>
            );
          })}
        </nav>
      ) : null}

      {selectedType === null ? (
        <p className="mt-6 text-sm opacity-70">
          No kinds of work defined yet. What this business does is yours to name — the
          platform has no opinion.
        </p>
      ) : (
        <>
          {/* Grouped by this type's own statuses, in the tenant's own order (D6). */}
          {statuses.map((status) => {
            const inStatus = workItems.filter((item) => item.status.id === status.id);
            return (
              <section key={status.id} className="mt-6">
                <h2 className="text-sm font-medium">
                  {status.name}
                  <span className="ml-2 opacity-60">{inStatus.length}</span>
                </h2>

                {inStatus.length === 0 ? (
                  <p className="mt-1 text-sm opacity-60">Nothing here.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
                    {inStatus.map((item) => (
                      <li key={item.id} className="py-3">
                        <Link
                          href={`/organizations/${organizationId}/work/${item.id}`}
                          className="font-medium underline underline-offset-4"
                        >
                          {item.title}
                        </Link>
                        {item.customer || item.location || item.resource || item.asset ? (
                          <div className="text-sm opacity-70">
                            {[
                              item.customer?.label,
                              item.location?.label,
                              item.asset?.label,
                              item.resource ? `→ ${item.resource.label}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        ) : null}
                        {/* I9: the instant is absolute in the database and is rendered in
                            the organization's zone, never the server's or the reader's. */}
                        {item.window ? (
                          <div className="text-sm opacity-70">
                            {formatWindow(item.window, organization.timezone)}
                          </div>
                        ) : null}
                        <CustomFieldValues definitions={definitions} custom={item.custom} />
                        {maySchedule ? (
                          <ScheduleWorkItemForm
                            organizationId={organizationId}
                            workItemId={item.id}
                            resources={resourceOptions}
                            scheduled={item.window !== null}
                          />
                        ) : null}
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
            <p className="mt-8 text-sm opacity-70">
              Your role, {organization.role}, cannot add work items here.
            </p>
          )}

          <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
            <h2 className="text-sm font-medium">{selectedType.name} statuses</h2>
            <p className="mt-1 text-sm opacity-70">
              {statuses.length === 0
                ? 'None yet. These are yours to name — the platform has no opinion.'
                : statuses.map((status) => status.name).join(' → ')}
            </p>

            {mayConfigure && statuses.length > 0 ? (
              <div className="mt-3 divide-y divide-black/10 dark:divide-white/15">
                {statuses.map((status) => (
                  <EditStatusForm
                    key={status.id}
                    organizationId={organizationId}
                    status={status}
                  />
                ))}
              </div>
            ) : null}

            {mayConfigure ? (
              <CreateStatusForm organizationId={organizationId} typeId={selectedType.id} />
            ) : (
              <p className="mt-2 text-sm opacity-70">
                Your role, {organization.role}, cannot configure statuses here.
              </p>
            )}
          </section>

          <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
            <h2 className="text-sm font-medium">Allowed moves</h2>
            {/* An unconfigured type is frozen, not unconstrained — I13 has exactly one
                reading when a tenant has configured no transitions at all. Saying so here is
                the difference between a board that looks broken and one that is unfinished. */}
            <p className="mt-1 text-sm opacity-70">
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
            </p>

            {mayConfigure ? (
              <CreateTransitionForm
                organizationId={organizationId}
                typeId={selectedType.id}
                statuses={statuses}
              />
            ) : (
              <p className="mt-2 text-sm opacity-70">
                Your role, {organization.role}, cannot configure transitions here.
              </p>
            )}
          </section>

          <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
            <h2 className="text-sm font-medium">Steps every {selectedType.name} involves</h2>
            {/* Copied onto each job at creation, never joined. Editing this list does not
                reach a job that already exists — which is what makes editing it safe (I8). */}
            <p className="mt-1 text-sm opacity-70">
              {templateSteps.length === 0
                ? 'None. Work items of this kind start with an empty checklist.'
                : 'Copied onto each new work item. Changing them leaves existing work alone.'}
            </p>

            {templateSteps.length > 0 ? (
              <div className="mt-2 divide-y divide-black/10 dark:divide-white/15">
                {templateSteps.map((item) =>
                  mayConfigure ? (
                    <TypeChecklistItemRow
                      key={item.id}
                      organizationId={organizationId}
                      item={item}
                    />
                  ) : (
                    <p key={item.id} className="py-1 text-sm opacity-70">
                      {item.label}
                    </p>
                  ),
                )}
              </div>
            ) : null}

            {mayConfigure ? (
              <AddTypeChecklistItemForm
                organizationId={organizationId}
                typeId={selectedType.id}
              />
            ) : null}
          </section>

          {/* **A module hides what it owns everywhere, not only its own area.** Switching public
              booking off takes this section away for the same reason switching billing off takes
              the quote off a job: hiding the area and leaving its controls scattered across other
              screens is half a switch. The public address itself is configured in Settings, which
              is where the module says it is set up — this is the per-type half of the same
              thing, and `outstandingModuleSetup` now names both. */}
          {bookingEnabled ? (
            <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
              <h2 className="text-sm font-medium">Publish to the public booking page</h2>
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
                <p className="mt-2 text-sm opacity-70">
                  Your role, {organization.role}, cannot change what this business publishes.
                </p>
              ) : null}
            </section>
          ) : null}

          {mayConfigure ? (
            <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
              <h2 className="text-sm font-medium">Rename this kind of work</h2>
              <RenameTypeForm
                organizationId={organizationId}
                typeId={selectedType.id}
                name={selectedType.name}
              />
            </section>
          ) : null}
        </>
      )}

      <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
        <h2 className="text-sm font-medium">Kinds of work</h2>
        <p className="mt-1 text-sm opacity-70">
          {types.length === 0
            ? 'None yet. A type is what scopes a board — statuses belong to one.'
            : types.map((type) => type.name).join(' · ')}
        </p>

        {mayConfigure ? (
          <CreateTypeForm organizationId={organizationId} />
        ) : (
          <p className="mt-2 text-sm opacity-70">
            Your role, {organization.role}, cannot configure work item types here.
          </p>
        )}
      </section>
    </>
  );
}
