import { FieldSet, FieldLegend, FieldGroup } from '@gold/ui/components/field';
import type { OperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { OperatingHoursEditor } from './operating-hours-editor';
import { ScheduleBufferForm } from './schedule-buffer-form';

export type ScheduleConfigurationData = {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  hours: OperatingHours[];
  timezone: string;
  bufferMinutes: number;
};

/**
 * When this business is open — the input `freeWindows` reads before it decides what's
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
  bufferMinutes,
}: ScheduleConfigurationData) {
  return (
    <div className="flex flex-col gap-8">
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
      <FieldSet>
        <FieldLegend>Scheduling buffer</FieldLegend>
        <FieldGroup>
          <ScheduleBufferForm
            organizationId={organizationId}
            bufferMinutes={bufferMinutes}
            mayConfigure={mayConfigure}
          />
        </FieldGroup>
      </FieldSet>
    </div>
  );
}
