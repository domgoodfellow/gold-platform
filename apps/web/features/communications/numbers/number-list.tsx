import Link from 'next/link';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { PhoneNumber, PhoneNumberOrigin } from '@/lib/domain/reception/numbers';

const LIFECYCLE_TONE: Record<PhoneNumber['lifecycle'], 'success' | 'neutral' | 'danger'> = {
  active: 'success',
  inactive: 'neutral',
  quarantined: 'danger',
};

const HEALTH_TONE: Record<string, 'success' | 'neutral' | 'danger'> = {
  healthy: 'success',
  unknown: 'neutral',
  degraded: 'danger',
  failed: 'danger',
};

export const ORIGIN_LABEL: Record<PhoneNumberOrigin, string> = {
  provisioned: 'Provisioned',
  external: 'External',
  browser: 'Browser',
  sip: 'SIP',
};

/** The canonical responsive rendering of a business's number inventory. */
export function NumberList({ organizationId, numbers, assignedCount }: {
  organizationId: string;
  numbers: PhoneNumber[];
  assignedCount: Map<string, number>;
}) {
  return (
    <DataTable
      rows={numbers}
      rowKey={(number) => number.id}
      empty="No numbers recorded."
      columns={[
        {
          key: 'number',
          header: 'Number',
          emphasis: 'primary',
          cell: (number) => (
            <Link href={`/organizations/${organizationId}/comms/numbers/${number.id}`} className="underline underline-offset-2">
              {number.label ? `${number.e164} (${number.label})` : number.e164}
            </Link>
          ),
        },
        { key: 'origin', header: 'Origin', cell: (number) => <Badge>{ORIGIN_LABEL[number.origin]}</Badge> },
        { key: 'purpose', header: 'Purpose', emphasis: 'secondary', cell: (number) => <Badge>{number.purpose}</Badge> },
        { key: 'lifecycle', header: 'Status', cell: (number) => <Badge tone={LIFECYCLE_TONE[number.lifecycle]}>{number.lifecycle}</Badge> },
        {
          key: 'capabilities',
          header: 'Capabilities',
          cell: (number) => (
            <span className="flex gap-1">
              {number.inboundEnabled ? <Badge>Inbound</Badge> : null}
              {number.outboundEnabled ? <Badge>Outbound</Badge> : null}
              {!number.inboundEnabled && !number.outboundEnabled ? <span className="text-subtle">None</span> : null}
            </span>
          ),
        },
        { key: 'health', header: 'Health', emphasis: 'secondary', cell: (number) => <Badge tone={HEALTH_TONE[number.health] ?? 'neutral'}>{number.health}</Badge> },
        { key: 'assignments', header: 'Assigned to', numeric: true, cell: (number) => assignedCount.get(number.id) ?? 0 },
      ]}
    />
  );
}
