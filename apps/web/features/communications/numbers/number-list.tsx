import Link from 'next/link';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { PhoneNumber } from '@/lib/domain/reception/numbers';
import { ORIGIN_LABEL, PURPOSE_LABEL, READINESS_LABEL, READINESS_TONE, capabilitySummary } from './labels';

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
      empty="This business has no numbers yet."
      columns={[
        {
          key: 'number',
          header: 'Number',
          emphasis: 'primary',
          cell: (number) => (
            <Link href={`/organizations/${organizationId}/comms/numbers/${number.id}`} className="underline underline-offset-4">
              {number.label ? `${number.label} (${number.e164})` : number.e164}
            </Link>
          ),
        },
        { key: 'purpose', header: 'Used for', cell: (number) => <Badge>{PURPOSE_LABEL[number.purpose]}</Badge> },
        { key: 'readiness', header: 'Status', cell: (number) => <Badge tone={READINESS_TONE[number.readiness]}>{READINESS_LABEL[number.readiness]}</Badge> },
        {
          key: 'capabilities',
          header: 'Can do',
          cell: (number) => {
            const words = capabilitySummary(number);
            return words.length ? (
              <span className="flex flex-wrap gap-1">{words.map((word) => <Badge key={word}>{word}</Badge>)}</span>
            ) : (
              <span className="text-subtle">Nothing</span>
            );
          },
        },
        { key: 'origin', header: 'Source', emphasis: 'secondary', cell: (number) => ORIGIN_LABEL[number.origin] },
        { key: 'assignments', header: 'Assigned to', numeric: true, cell: (number) => assignedCount.get(number.id) ?? 0 },
      ]}
    />
  );
}
