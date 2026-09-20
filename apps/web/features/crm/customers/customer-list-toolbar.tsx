import { Search } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import type { CustomerStage } from '@/lib/domain/customers/stages';

export function CustomerListToolbar({
  organizationId,
  stages,
  search,
  stage,
}: {
  organizationId: string;
  stages: CustomerStage[];
  search: string;
  stage: string;
}) {
  return (
    <form className="flex flex-col gap-2 sm:flex-row" role="search">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <TextInput name="q" defaultValue={search} placeholder="Search customers" aria-label="Search customers" className="w-full pl-9" />
      </div>
      {stages.length > 0 ? (
        <SelectInput name="stage" defaultValue={stage} aria-label="Filter by stage" className="w-full sm:w-48">
          <option value="">All stages</option>
          <option value="unstaged">No stage</option>
          {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </SelectInput>
      ) : null}
      <Button type="submit" tone="secondary">Filter</Button>
      {search || stage ? (
        <ButtonLink href={`/organizations/${organizationId}/customers`} tone="text">Clear</ButtonLink>
      ) : null}
    </form>
  );
}
