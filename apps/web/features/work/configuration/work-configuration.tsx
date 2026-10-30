import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { cx } from '@/components/class-names';
import { DividedList, EmptyState, GroupHeading } from '@/components/surfaces/section';
import { ViewNav } from '@/components/navigation/view-nav';
import { NavigationList } from '@/components/navigation/navigation-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import type { WorkItemTransition } from '@/lib/domain/work-items/transitions';
import type { TypeBooking, WorkItemType } from '@/lib/domain/work-items/types';
import type { TypeChecklistItem } from '@/lib/domain/work-items/checklists';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import type { ResourceRequirement } from '@/lib/domain/work-items/requirements';
import { NewTypeDialog } from './new-type-dialog';
import { ResourceRequirementsEditor } from './resource-requirements';
import {
  AddTypeChecklistItemForm,
  CreateStatusForm,
  CreateTransitionForm,
  EditStatusForm,
  PublishTypeForm,
  RenameTypeForm,
  SchedulingTypeForm,
  TypeChecklistItemRow,
} from './work-config-forms';

export type WorkConfigurationData = {
  /** The tab a deep link asked for (`?tab=booking`). */
  initialTab?: string;
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  types: WorkItemType[];
  selectedType: WorkItemType | null;
  statuses: WorkItemStatus[];
  transitions: WorkItemTransition[];
  templateSteps: TypeChecklistItem[];
  fieldDefinitions: FieldDefinition[];
  prices: PriceBookItem[];
  booking: TypeBooking | null;
  bookingEnabled: boolean;
  /** What the selected type needs. Only meaningful, and only shown, for a type that is scheduled. */
  requirements: ResourceRequirement[];
  /** The active capability vocabulary a requirement may name. */
  capabilities: ResourceCapability[];
  /** The forms a public booking of the selected type may ask: published, not archived. */
  intakeForms: Array<{ id: string; name: string }>;
  /** Where a type link should point — the Work page's Configure rail and the configuration route use different base paths. */
  typeHref: (typeId: string) => string;
  /**
   * `page` is the routed screen: a list beside the selected type on wide screens, one level at a
   * time on narrow ones. `rail` is the narrow Configure panel: a compact type strip above the type.
   */
  variant?: 'page' | 'rail';
  /** Page variant only: whether the URL named a type. On a narrow screen that opens the type; otherwise the list shows. */
  typeRequested?: boolean;
  /** Page variant only: the list of types, where a narrow screen's back link returns. */
  listHref?: string;
  /** Opens the New type drawer on load (`?new=1`). */
  createOpen?: boolean;
};

/**
 * Kinds of work, workflow, requirements, checklists and fields — the shape of Work, apart from
 * doing it. One component behind both the routed configuration page and the Work page's Configure
 * rail, so both read and change the same thing; only the arrangement differs by `variant`.
 *
 * Deliberately excludes operating hours: those describe Schedule, not Work, and stay on the
 * owner route directly rather than in this shared, rail-hosted component.
 */
export function WorkConfiguration(props: WorkConfigurationData) {
  const { organizationId, mayConfigure, types, selectedType, typeHref, createOpen, variant = 'page' } = props;
  const newType = mayConfigure ? (
    <NewTypeDialog organizationId={organizationId} typeHrefPrefix={typeHref('')} defaultOpen={createOpen} />
  ) : null;

  if (types.length === 0) {
    return (
      <EmptyState title="No work types yet" action={newType}>
        {mayConfigure ? null : 'Someone who manages Work creates work types.'}
      </EmptyState>
    );
  }

  if (variant === 'rail') {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-start gap-2">
          <ViewNav label="Work types" className="mb-0 flex-1" current={selectedType?.id} views={types.map(type => ({ key: type.id, label: type.name, href: typeHref(type.id) }))} />
          {newType}
        </div>
        <TypeDetail {...props} />
      </div>
    );
  }

  const showDetail = Boolean(props.typeRequested);
  return (
    <div className="@container min-w-0">
    <div className="grid min-w-0 gap-5 @3xl:grid-cols-[13rem_minmax(0,1fr)] @3xl:items-start">
      <div className={cx('min-w-0', showDetail && 'hidden @3xl:block')}>
        <div className="mb-1 flex min-h-9 items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Work types</h2>{newType}
        </div>
        <NavigationList label="Work types" density="compact" current={selectedType?.id} items={types.map(type => ({ key: type.id, title: type.name, href: typeHref(type.id), metadata: `${type.schedulable ? 'Scheduled' : 'Not scheduled'}${type.id === selectedType?.id ? ' · Selected' : ''}`, chevron: true }))} />
      </div>

      <div className={cx('min-w-0', !showDetail && 'hidden @3xl:block')}>
        {props.listHref ? (
          <Link href={props.listHref} className="mb-3 inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-foreground @3xl:hidden">
            <ChevronLeft aria-hidden className="size-4" />
            Work types
          </Link>
        ) : null}
        <TypeDetail {...props} />
      </div>
    </div>
    </div>
  );
}

/** One type's configuration. Everything here belongs to `selectedType` — nothing reaches another type. */
function TypeDetail({
  organizationId,
  role,
  mayConfigure,
  selectedType,
  statuses,
  transitions,
  templateSteps,
  fieldDefinitions,
  prices,
  booking,
  bookingEnabled,
  requirements,
  capabilities,
  intakeForms,
  initialTab,
}: WorkConfigurationData) {
  if (!selectedType) return null;

  const tabs = ['general', 'workflow', ...(selectedType.schedulable ? ['requirements'] : []), 'checklists', ...(bookingEnabled ? ['booking'] : []), 'fields'];
  // `?tab=` is a deep link, kept: the earlier name `types` still means General, and an unknown or unavailable value falls back to it.
  const requested = initialTab === 'types' ? 'general' : initialTab;
  const startTab = requested && tabs.includes(requested) ? requested : initialTab === undefined && statuses.length === 0 ? 'workflow' : 'general';
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));
  const position = new Map(statuses.map((status, index) => [status.id, index]));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="min-w-0">
        <h2 className="wrap-break-word text-lg font-semibold">{selectedType.name}</h2>
        <p className="mt-1 text-sm text-muted">{selectedType.schedulable ? 'Scheduled work' : 'Not scheduled'} · {statuses.length === 1 ? '1 stage' : `${statuses.length} stages`}{mayConfigure ? '' : ' · You can view this configuration but not change it'}. Changes here shape future work of this type; they never create work.</p>
      </div>

      <Tabs key={`${selectedType.id}:${initialTab ?? 'default'}`} defaultValue={startTab} className="min-w-0 gap-5">
        <TabsList aria-label="Work configuration">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          {selectedType.schedulable ? <TabsTrigger value="requirements">Requirements</TabsTrigger> : null}
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
          {bookingEnabled ? <TabsTrigger value="booking">Booking</TabsTrigger> : null}
          <TabsTrigger value="fields">Fields</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="flex max-w-2xl flex-col gap-5">
          <p className="text-sm text-muted">Name and scheduling behavior are saved separately.</p>
          {mayConfigure ? (
            <>
              <RenameTypeForm organizationId={organizationId} typeId={selectedType.id} name={selectedType.name} />
              <SchedulingTypeForm
                organizationId={organizationId}
                typeId={selectedType.id}
                typeName={selectedType.name}
                schedulable={selectedType.schedulable}
                published={booking !== null}
                disabled={false}
              />
            </>
          ) : (
            <p className="text-sm">{selectedType.schedulable ? 'Scheduled work.' : 'Not scheduled.'}</p>
          )}
        </TabsContent>

        <TabsContent value="workflow" className="flex max-w-3xl flex-col gap-8">
          {/* Stages in their order, then the moves between them: the workflow work of this type follows. */}
          <section className="flex flex-col gap-3" aria-labelledby="workflow-stages">
            <GroupHeading id="workflow-stages">Stages</GroupHeading>
            <p className="text-sm text-muted">{statuses.length === 0 ? 'A starting stage is required before creating Work of this type. Add the stage new Work starts in.' : 'New work starts in the first stage. Order sets the sequence.'}</p>
            {statuses.length > 0 ? (
              <ol aria-label="Stages in order" className="flex flex-col divide-y divide-border rounded-[var(--visual-radius,0.625rem)] border border-border">
                {statuses.map((status, index) => (
                  <li key={status.id} className="flex flex-col gap-1 px-3 py-1 sm:flex-row sm:items-center sm:gap-3">
                    <span className="flex shrink-0 items-center gap-2 pt-2 text-xs text-muted sm:w-24 sm:pt-0">
                      <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-secondary tabular-nums">{index + 1}</span>
                      {index === 0 ? 'Starts here' : null}
                    </span>
                    {mayConfigure ? <div className="min-w-0 flex-1"><EditStatusForm organizationId={organizationId} status={status} /></div> : <span className="py-2 text-sm">{status.name}</span>}
                  </li>
                ))}
              </ol>
            ) : null}
            {mayConfigure ? <CreateStatusForm organizationId={organizationId} typeId={selectedType.id} starting={statuses.length === 0} /> : null}
          </section>

          {statuses.length >= 2 ? (
            <section className="flex flex-col gap-3" aria-labelledby="workflow-moves">
              <GroupHeading id="workflow-moves">Allowed moves</GroupHeading>
              {/* An unconfigured type is frozen, not unconstrained. */}
              {transitions.length === 0 ? <p className="text-sm text-muted">None yet, so work of this type cannot change stage.</p> : (
                <ul aria-label="Allowed moves" className="flex flex-col gap-1 text-sm">
                  {[...transitions].sort((a, b) => (position.get(a.fromStatusId) ?? 0) - (position.get(b.fromStatusId) ?? 0) || (position.get(a.toStatusId) ?? 0) - (position.get(b.toStatusId) ?? 0)).map((t) => <li key={t.id}>{statusName.get(t.fromStatusId) ?? '?'} <span aria-hidden className="text-subtle">→</span><span className="sr-only"> to </span> {statusName.get(t.toStatusId) ?? '?'}</li>)}
                </ul>
              )}
              {mayConfigure ? <CreateTransitionForm organizationId={organizationId} typeId={selectedType.id} statuses={statuses} /> : null}
            </section>
          ) : null}
        </TabsContent>

        {selectedType.schedulable ? (
          <TabsContent value="requirements" className="max-w-2xl">
            <ResourceRequirementsEditor
              organizationId={organizationId}
              typeId={selectedType.id}
              typeName={selectedType.name}
              requirements={requirements}
              capabilities={capabilities}
              mayConfigure={mayConfigure}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="checklists" className="flex max-w-2xl flex-col gap-3">
          {/* Copied onto each job at creation, never joined — editing this list never reaches a job that already exists. */}
          <p className="text-sm text-muted">
            {templateSteps.length === 0 ? 'No steps yet.' : 'Steps are copied onto new work. Existing work is unchanged.'}
          </p>
          {templateSteps.length > 0 ? (
            <DividedList as="div">
              {templateSteps.map((item) =>
                mayConfigure ? (
                  <TypeChecklistItemRow key={item.id} organizationId={organizationId} item={item} />
                ) : (
                  <p key={item.id} className="py-1 text-sm">{item.label}</p>
                ),
              )}
            </DividedList>
          ) : null}
          {mayConfigure ? <AddTypeChecklistItemForm organizationId={organizationId} typeId={selectedType.id} /> : null}
        </TabsContent>

        {bookingEnabled ? (
          <TabsContent value="booking" className="max-w-2xl">
            <p className="text-sm text-muted">Booking decides whether customers can request this work online and on what terms. When it can happen still comes from Schedule hours and each resource&rsquo;s availability.</p>
            <PublishTypeForm
              organizationId={organizationId}
              typeId={selectedType.id}
              typeName={selectedType.name}
              statuses={statuses}
              prices={prices}
              booking={booking}
              intakeForms={intakeForms}
              schedulable={selectedType.schedulable}
              disabled={!mayConfigure}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="fields" className="flex max-w-2xl flex-col gap-3">
          <p className="text-sm text-muted">Custom fields apply to every work type.</p>
          <EntityFieldsConfiguration
            organizationId={organizationId}
            entityType="work_item"
            role={role}
            mayConfigure={mayConfigure}
            definitions={fieldDefinitions}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
