import type { ReactNode } from 'react';
import { Badge } from '@/components/display/data';
import { DataTable } from '@/components/display/table';
import type { Call } from '@/lib/domain/reception/calls';

/** The canonical responsive rendering of call history. */
export function CallHistory({ calls, customerNames, renderWrapUp, empty = 'No calls recorded.' }: {
  calls: Call[];
  customerNames?: Map<string, string>;
  renderWrapUp?: (call: Call) => ReactNode;
  empty?: string;
}) {
  return (
    <DataTable
      rows={calls}
      rowKey={(call) => call.id}
      empty={empty}
      columns={[
        { key: 'call', header: customerNames ? 'Customer' : 'Call', emphasis: 'primary', cell: (call) => customerNames?.get(call.customerId) ?? (call.direction === 'inbound' ? 'Inbound' : 'Outbound') },
        { key: 'direction', header: 'Direction', cell: (call) => <Badge>{call.direction === 'inbound' ? 'Inbound' : 'Outbound'}</Badge> },
        { key: 'number', header: 'Number', cell: (call) => call.direction === 'inbound' ? call.fromNumber : call.toNumber },
        { key: 'network', header: 'Network', cell: (call) => <Badge>{call.status.replaceAll('_', ' ')}</Badge> },
        { key: 'duration', header: 'Duration', numeric: true, cell: (call) => call.durationSeconds === null ? '—' : `${call.durationSeconds}s` },
        { key: 'outcome', header: 'Outcome', cell: (call) => call.outcome?.name ?? <span className="text-subtle">Not written up</span> },
        { key: 'note', header: 'Note', emphasis: 'secondary', cell: (call) => call.note || <span className="text-subtle">—</span> },
      ]}
      actions={renderWrapUp}
    />
  );
}
