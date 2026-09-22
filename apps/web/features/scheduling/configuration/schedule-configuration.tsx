import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import type { OperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { OperatingHoursEditor } from './operating-hours-editor';

export type ScheduleConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  hours: OperatingHours[];
  timezone: string;
};

/**
 * When this business is open — the input `freeWindows` (I5) reads before it decides what's
 * free. The same component from the Schedule page's Configure rail and Schedule's own
 * configuration route (contract: one configuration surface, every host — the Work pattern,
 * generalized). Scheduling owns this presentation outright: it reaches into no Settings UI.
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
        <OperatingHoursEditor
          organizationId={organizationId}
          role={role}
          mayConfigure={mayConfigure}
          hours={hours}
          timezone={timezone}
        />
      </FieldGroup>
    </FieldSet>
  );
}
