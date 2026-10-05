import Link from 'next/link';
import { DividedList, EmptyState } from '@/components/surfaces/section';
import { Hint } from '@/components/controls/inputs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@gold/ui/components/tabs';
import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import { Item, ItemContent, ItemGroup, ItemTitle } from '@gold/ui/components/item';
import { EntityFieldsConfiguration } from '@/features/custom-fields/configuration/entity-fields-configuration';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import type { WorkItemTransition } from '@/lib/domain/work-items/transitions';
import type { TypeBooking, WorkItemType } from '@/lib/domain/work-items/types';
import type { TypeChecklistItem } from '@/lib/domain/work-items/checklists';
import type { ResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import type { ResourceRequirement } from '@/lib/domain/work-items/requirements';
import { ResourceRequirementsEditor } from './resource-requirements';
import {
  AddTypeChecklistItemForm,
  CreateStatusForm,
  CreateTransitionForm,
  CreateTypeForm,
  EditStatusForm,
  PublishTypeForm,
  RenameTypeForm,
  SchedulingTypeForm,
  TypeChecklistItemRow,
} from './work-config-forms';

export type WorkConfigurationData = {
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
  /** Where a chip/type link should point — differs between the Work page (`?type=`) and Settings (`?type=` too, but a different base path). */
  typeHref: (typeId: string) => string;
};

/**
 * Kinds of work, workflow, checklists and fields — the shape of Work, apart from doing it. One
 * component so a business configuring from the Work page's Configure rail and one editing from
 * Work configuration sees, and changes, the exact same thing as the Work Configure rail.
 *
 * Deliberately excludes operating hours: those describe Schedule, not Work, and stay on the
 * owner route directly rather than in this shared, rail-hosted component.
 */
export function WorkConfiguration({
  organizationId,
  role,
  mayConfigure,
  types,
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
  typeHref,
}: WorkConfigurationData) {
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));

  return (
    <div className="flex flex-col gap-4">
      {types.length > 0 ? (
        <nav className="flex flex-wrap gap-2" aria-label="Kind of work">
          {types.map((type) => {
            const current = type.id === selectedType?.id;
            return (
              <Link
                key={type.id}
                href={typeHref(type.id)}
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

      <Tabs defaultValue="types">
        <TabsList>
          <TabsTrigger value="types">Types</TabsTrigger>
          <TabsTrigger value="workflow">Workflow</TabsTrigger>
          <TabsTrigger value="checklists">Checklists</TabsTrigger>
          <TabsTrigger value="fields">Fields</TabsTrigger>
        </TabsList>

        <TabsContent value="types" className="mt-4 flex flex-col gap-8">
          <FieldSet>
            <FieldLegend>Kinds of work</FieldLegend>
            {types.length === 0 ? (
              <EmptyState>A type is what scopes a board — statuses belong to one. Name what this business does.</EmptyState>
            ) : (
              <ItemGroup>
                {types.map((type) => (
                  <Item key={type.id} variant="outline" size="sm">
                    <ItemContent>
                      <ItemTitle>{type.name}</ItemTitle>
                      <p className="text-sm text-muted">{type.schedulable ? 'Scheduled' : 'Not scheduled'}</p>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
            {mayConfigure ? (
              <CreateTypeForm organizationId={organizationId} />
            ) : (
              <Hint>Your role, {role}, cannot configure work item types here.</Hint>
            )}
          </FieldSet>

          {selectedType ? (
            <FieldSet>
              <FieldLegend variant="label">Rename {selectedType.name}</FieldLegend>
              {mayConfigure ? (
                <RenameTypeForm organizationId={organizationId} typeId={selectedType.id} name={selectedType.name} />
              ) : (
                <Hint>Your role, {role}, cannot rename work item types here.</Hint>
              )}
            </FieldSet>
          ) : null}

          {selectedType ? (
            <FieldSet>
              <FieldLegend variant="label">Scheduling for {selectedType.name}</FieldLegend>
              <SchedulingTypeForm
                organizationId={organizationId}
                typeId={selectedType.id}
                typeName={selectedType.name}
                schedulable={selectedType.schedulable}
                published={booking !== null}
                disabled={!mayConfigure}
              />
              {!mayConfigure ? <Hint>Your role, {role}, cannot change whether work is scheduled.</Hint> : null}
            </FieldSet>
          ) : null}

          {selectedType && selectedType.schedulable ? (
            <FieldSet>
              <FieldLegend variant="label">Resources needed for {selectedType.name}</FieldLegend>
              <ResourceRequirementsEditor
                organizationId={organizationId}
                typeId={selectedType.id}
                typeName={selectedType.name}
                requirements={requirements}
                capabilities={capabilities}
                mayConfigure={mayConfigure}
              />
            </FieldSet>
          ) : null}

          {selectedType && bookingEnabled ? (
            <FieldSet>
              <FieldLegend variant="label">Publish {selectedType.name} to the public booking page</FieldLegend>
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
              {!mayConfigure ? <Hint>Your role, {role}, cannot change what this business publishes.</Hint> : null}
            </FieldSet>
          ) : null}
        </TabsContent>

        <TabsContent value="workflow" className="mt-4 flex flex-col gap-8">
          {selectedType === null ? (
            <EmptyState>No kinds of work defined yet — add one under Types first.</EmptyState>
          ) : (
            <>
              <FieldSet>
                <FieldLegend>{selectedType.name} statuses</FieldLegend>
                <FieldGroup>
                  <Hint>
                    {statuses.length === 0
                      ? 'None yet. These are yours to name — the platform has no opinion.'
                      : statuses.map((status) => status.name).join(' → ')}
                  </Hint>
                  {mayConfigure && statuses.length > 0 ? (
                    <DividedList as="div">
                      {statuses.map((status) => (
                        <EditStatusForm key={status.id} organizationId={organizationId} status={status} />
                      ))}
                    </DividedList>
                  ) : null}
                  {mayConfigure ? (
                    <CreateStatusForm organizationId={organizationId} typeId={selectedType.id} />
                  ) : (
                    <Hint>Your role, {role}, cannot configure statuses here.</Hint>
                  )}
                </FieldGroup>
              </FieldSet>

              <FieldSet>
                <FieldLegend>Allowed moves</FieldLegend>
                <FieldGroup>
                  {/* An unconfigured type is frozen, not unconstrained (I13). */}
                  <Hint>
                    {transitions.length === 0
                      ? 'None yet, so nothing on this board can move. Wire the moves this business actually makes.'
                      : transitions
                          .map((t) => `${statusName.get(t.fromStatusId) ?? '?'} → ${statusName.get(t.toStatusId) ?? '?'}`)
                          .join(' · ')}
                  </Hint>
                  {mayConfigure ? (
                    <CreateTransitionForm organizationId={organizationId} typeId={selectedType.id} statuses={statuses} />
                  ) : (
                    <Hint>Your role, {role}, cannot configure transitions here.</Hint>
                  )}
                </FieldGroup>
              </FieldSet>
            </>
          )}
        </TabsContent>

        <TabsContent value="checklists" className="mt-4">
          {selectedType === null ? (
            <EmptyState>No kinds of work defined yet — add one under Types first.</EmptyState>
          ) : (
            <FieldSet>
              <FieldLegend>Steps every {selectedType.name} involves</FieldLegend>
              <FieldGroup>
                {/* Copied onto each job at creation, never joined (I8) — editing this list never reaches a job that already exists. */}
                <Hint>
                  {templateSteps.length === 0
                    ? 'None. Work items of this kind start with an empty checklist.'
                    : 'Copied onto each new work item. Changing them leaves existing work alone.'}
                </Hint>
                {templateSteps.length > 0 ? (
                  <DividedList as="div">
                    {templateSteps.map((item) =>
                      mayConfigure ? (
                        <TypeChecklistItemRow key={item.id} organizationId={organizationId} item={item} />
                      ) : (
                        <Hint key={item.id} className="py-1">{item.label}</Hint>
                      ),
                    )}
                  </DividedList>
                ) : null}
                {mayConfigure ? (
                  <AddTypeChecklistItemForm organizationId={organizationId} typeId={selectedType.id} />
                ) : null}
              </FieldGroup>
            </FieldSet>
          )}
        </TabsContent>

        <TabsContent value="fields" className="mt-4">
          <FieldSet>
            <FieldLegend>Custom fields on a work item</FieldLegend>
            <FieldGroup>
              <EntityFieldsConfiguration
                organizationId={organizationId}
                entityType="work_item"
                role={role}
                mayConfigure={mayConfigure}
                definitions={fieldDefinitions}
              />
            </FieldGroup>
          </FieldSet>
        </TabsContent>
      </Tabs>
    </div>
  );
}
