import { DividedList, EmptyState } from '@/components/containers/section';
import { Hint } from '@/components/controls/inputs';
import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import { AddOperatingHoursForm, OperatingHoursRow } from '@/app/organizations/[organizationId]/settings/settings-forms';
import type { OperatingHours } from '@/lib/domain/scheduling/operating-hours';

export type ScheduleConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  hours: OperatingHours[];
  timezone: string;
};

/**
 * When this business is open — the input `freeWindows` (I5) reads before it decides what's
 * free. The same component from the Schedule page's Configure rail and Settings → Schedule
 * (contract: one configuration surface, every host — the Work pattern, generalized).
 */
export function ScheduleConfiguration({
  organizationId,
  role,
  mayConfigure,
  hours,
  timezone,
}: ScheduleConfigurationData) {
  return (
    <FieldSet>
      <FieldLegend>Opening hours</FieldLegend>
      <FieldGroup>
        {hours.length === 0 ? (
          <EmptyState>
            No opening hours set, so the schedule treats every hour as available. Nothing here is
            assumed — which days this business works, and when, are yours to say.
          </EmptyState>
        ) : (
          <>
            <Hint>Times are read in {timezone}.</Hint>
            <DividedList as="div">
              {hours.map((entry) =>
                mayConfigure ? (
                  <OperatingHoursRow key={entry.id} organizationId={organizationId} hours={entry} />
                ) : (
                  <Hint key={entry.id} className="py-2">
                    {entry.opensAt.slice(0, 5)}–{entry.closesAt.slice(0, 5)}
                  </Hint>
                ),
              )}
            </DividedList>
          </>
        )}

        {mayConfigure ? (
          <AddOperatingHoursForm organizationId={organizationId} />
        ) : (
          <Hint>Your role, {role}, cannot set opening hours.</Hint>
        )}
      </FieldGroup>
    </FieldSet>
  );
}
