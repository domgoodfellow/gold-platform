import Link from 'next/link';
import { Card, Disclosure } from '@/components/containers/card';
import { EmptyState, SectionHeading } from '@/components/containers/section';
import { ButtonLink } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { CustomFieldValues } from '@/features/custom-fields/values';
import type { Counted } from '@/lib/domain/counted';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { formatWindow } from '@/lib/domain/scheduling/window';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import { allowedNextStatusIds, type WorkItemTransition } from '@/lib/domain/work-items/transitions';
import type { WorkItemType } from '@/lib/domain/work-items/types';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import { CreateWorkItemForm } from './work-create-form';
import { MoveWorkItemForm, ScheduleWorkItemForm } from './work-operations-forms';

export function WorkList({ organizationId, role, timezone, types, selectedType, statuses, transitions, workItems, customers, locations, resources, assets, definitions, assetsEnabled, mayAdd, mayConfigure, mayMove, maySchedule }: {
  organizationId: string;
  role: string;
  timezone: string;
  types: WorkItemType[];
  selectedType: WorkItemType | null;
  statuses: WorkItemStatus[];
  transitions: WorkItemTransition[];
  workItems: Counted<WorkItem>;
  customers: { id: string; label: string }[];
  locations: { id: string; label: string }[];
  resources: { id: string; label: string }[];
  assets: { id: string; label: string }[];
  definitions: FieldDefinition[];
  assetsEnabled: boolean;
  mayAdd: boolean;
  mayConfigure: boolean;
  mayMove: boolean;
  maySchedule: boolean;
}) {
  const configHref = `/organizations/${organizationId}/settings/work`;
  const statusName = new Map(statuses.map((status) => [status.id, status.name]));

  return (
    <>
      {types.length > 0 ? (
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Kind of work">
          {types.map((type) => {
            const current = type.id === selectedType?.id;
            return (
              <ButtonLink
                key={type.id}
                href={`/organizations/${organizationId}/work?type=${type.id}`}
                aria-current={current ? 'page' : undefined}
                tone={current ? 'primary' : 'secondary'}
                size="small"
                className="shrink-0"
              >
                {type.name}
              </ButtonLink>
            );
          })}
        </nav>
      ) : null}

      {selectedType === null ? (
        <EmptyState className="mt-6">
          No kinds of work are configured.{' '}
          {mayConfigure ? (
            <Link href={configHref} className="underline underline-offset-4">
              Configure Work in Settings
            </Link>
          ) : null}
        </EmptyState>
      ) : (
        <>
          {mayAdd ? (
            <Disclosure
              summary="Add work"
              tone="primary"
              defaultOpen={workItems.length === 0}
              className="mt-5"
            >
              <CreateWorkItemForm
                organizationId={organizationId}
                statuses={statuses}
                customers={customers}
                locations={locations}
                resources={resources}
                assets={assets}
                assetsEnabled={assetsEnabled}
                definitions={definitions}
              />
            </Disclosure>
          ) : (
            <Hint className="mt-5">Your role, {role}, cannot add work items here.</Hint>
          )}

          {workItems.total > workItems.length ? (
            <Hint weight="subtle" className="mt-4">
              Showing the {workItems.length} most recent of {workItems.total} in this kind of work.
            </Hint>
          ) : null}

          {statuses.map((status) => {
            const rows = workItems.filter((item) => item.status.id === status.id);
            return (
              <section key={status.id} className="mt-7" aria-labelledby={`status-${status.id}`}>
                <SectionHeading id={`status-${status.id}`}>
                  {status.name}
                  <span className="ml-2 text-subtle">{rows.length}</span>
                </SectionHeading>
                {rows.length === 0 ? (
                  <EmptyState weight="subtle" className="mt-1">
                    Nothing here.
                  </EmptyState>
                ) : (
                  <ul className="mt-3 grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,19rem),1fr))]">
                    {rows.map((item) => (
                      <li key={item.id}>
                        <Card className="flex h-full flex-col">
                          <Link
                            href={`/organizations/${organizationId}/work/${item.id}`}
                            className="font-medium underline underline-offset-4"
                          >
                            {item.title}
                          </Link>
                          <div className="mt-1 text-sm">
                            {item.window ? (
                              <span className="tabular-nums text-muted">
                                {formatWindow(item.window, timezone)}
                              </span>
                            ) : (
                              <span className="font-medium text-foreground">Not scheduled</span>
                            )}
                          </div>
                          {item.customer || item.location || (assetsEnabled && item.asset) || item.resource ? (
                            <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                              <dt className="text-subtle">Customer</dt>
                              <dd>{item.customer?.label ?? '—'}</dd>
                              <dt className="text-subtle">Location</dt>
                              <dd>{item.location?.label ?? '—'}</dd>
                              {assetsEnabled ? (
                                <>
                                  <dt className="text-subtle">Asset</dt>
                                  <dd>{item.asset?.label ?? '—'}</dd>
                                </>
                              ) : null}
                              <dt className="text-subtle">Assigned</dt>
                              <dd>
                                {item.resource ? <Badge tone="accent">{item.resource.label}</Badge> : '—'}
                              </dd>
                            </dl>
                          ) : null}
                          <CustomFieldValues definitions={definitions} custom={item.custom} />
                          {mayMove || maySchedule ? (
                            <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                              <MoveWorkItemForm
                                organizationId={organizationId}
                                workItemId={item.id}
                                moves={
                                  mayMove
                                    ? allowedNextStatusIds(transitions, item.status.id).flatMap((id) => {
                                        const name = statusName.get(id);
                                        return name ? [{ id, name }] : [];
                                      })
                                    : []
                                }
                              />
                              {maySchedule ? (
                                <Disclosure
                                  summary={item.window ? 'Reschedule' : 'Schedule'}
                                  className="border-0"
                                >
                                  <ScheduleWorkItemForm
                                    organizationId={organizationId}
                                    workItemId={item.id}
                                    resources={resources}
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
        </>
      )}

      {mayConfigure ? (
        <Hint className="mt-10">
          Kinds of work, statuses, allowed moves and checklists are configured in{' '}
          <Link href={configHref} className="underline underline-offset-4">
            Settings → Work
          </Link>
          .
        </Hint>
      ) : null}
    </>
  );
}
