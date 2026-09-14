import { DividedList, EmptyState } from '@/components/containers/section';
import type { Customer } from '@/lib/domain/customers/customers';
import type { CustomerStage } from '@/lib/domain/customers/stages';

export function PipelineSummary({ stages, customers, limit = 4 }: { stages: CustomerStage[]; customers: Customer[]; limit?: number }) {
  if (stages.length === 0) return <EmptyState weight="subtle">No stages named.</EmptyState>;
  const counts = new Map<string, number>();
  for (const customer of customers) if (customer.stageId) counts.set(customer.stageId, (counts.get(customer.stageId) ?? 0) + 1);
  return (
    <DividedList className="text-sm">
      {stages.slice(0, limit).map((stage) => (
        <li key={stage.id} className="flex items-baseline gap-2 py-1.5">
          <span className="min-w-0 truncate">{stage.name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-muted">{counts.get(stage.id) ?? 0}</span>
        </li>
      ))}
    </DividedList>
  );
}
