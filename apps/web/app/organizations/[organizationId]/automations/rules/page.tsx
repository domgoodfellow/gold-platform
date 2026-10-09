import { CollectionHeader } from '@/components/patterns/collection-header';
import { requireOrganization } from '@/lib/route/organization';
import {
  automationReviewContext,
  automationPeriod,
} from '@/lib/application/automations/dashboard';
import { getAutomationSummary } from '@/lib/domain/automation/monitoring';
import { workspaceAncestry } from '@/lib/navigation';
import { RulesTable } from '@/features/automations/rules/rules-table';
import { NewAutomationSheet } from '@/features/automations/rules/new-automation-sheet';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';

export const dynamic = 'force-dynamic';
export default async function AutomationRulesPage({
  params,
  searchParams,
}: PageProps<'/organizations/[organizationId]/automations/rules'>) {
  const { organizationId } = await params;
  const query = await searchParams;
  const first = (key: string) => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const { db, organization } = await requireOrganization(organizationId);
  const mayManage = organization.capabilities.includes('automation.manage');
  const period = automationPeriod(organization.timezone);
  const [{ rules, warnings }, summary] = await Promise.all([
    automationReviewContext(db, organizationId),
    getAutomationSummary(db, { organizationId, ...period }),
  ]);
  const filtered = rules.filter(
    (r) =>
      (!first('q') ||
        r.name.toLowerCase().includes(first('q')!.toLowerCase())) &&
      (!first('trigger') || r.triggerKind === first('trigger')) &&
      (!first('status') ||
        (first('status') === 'enabled' ? r.enabled : !r.enabled)) &&
      (first('health') !== 'attention' ||
        warnings.some((w) => w.ruleId === r.id) ||
        !r.actions.length),
  );
  filtered.sort((a, b) =>
    first('sort') === 'name'
      ? a.name.localeCompare(b.name)
      : b.createdAt.localeCompare(a.createdAt),
  );
  const page = Math.max(1, Number(first('page')) || 1);
  const href = (next: number) => {
    const p = new URLSearchParams();
    for (const key of ['q', 'trigger', 'status', 'health', 'sort'])
      if (first(key)) p.set(key, first(key)!);
    p.set('page', String(next));
    return `?${p}`;
  };
  return (
    <div className="min-w-0">
      <CollectionHeader
        title="Automations"
        crumbs={workspaceAncestry(organizationId, 'automation-rules')}
        actions={
          mayManage ? (
            <NewAutomationSheet organizationId={organizationId} defaultOpen={first('create') === '1'} />
          ) : null
        }
      />
      <form className="my-3 flex flex-wrap items-center gap-2">
        <TextInput
          name="q"
          aria-label="Search rules"
          placeholder="Search rules..."
          defaultValue={first('q')}
          className="w-52"
          size="small"
        />
        <SelectInput
          name="status"
          aria-label="Rule status"
          defaultValue={first('status') ?? ''}
          size="small"
        >
          <option value="">All statuses</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </SelectInput>
        <SelectInput
          name="trigger"
          aria-label="Trigger kind"
          defaultValue={first('trigger') ?? ''}
          size="small"
        >
          <option value="">All triggers</option>
          <option value="event">Event</option>
          <option value="schedule">Schedule</option>
          <option value="external_reading">External reading</option>
          <option value="counter_threshold">Counter threshold</option>
        </SelectInput>
        <SelectInput
          name="health"
          aria-label="Configuration health"
          defaultValue={first('health') ?? ''}
          size="small"
        >
          <option value="">All configurations</option>
          <option value="attention">Needs attention</option>
        </SelectInput>
        <SelectInput
          name="sort"
          aria-label="Sort rules"
          defaultValue={first('sort') ?? 'recent'}
          size="small"
        >
          <option value="recent">Newest first</option>
          <option value="name">Name</option>
        </SelectInput>
        <Button size="small" tone="secondary">
          Apply filters
        </Button>
      </form>
      <p className="text-xs text-subtle">
        {filtered.length} matching rules - latest executions reflect all
        recorded history.
      </p>
      <RulesTable
        organizationId={organizationId}
        rules={filtered.slice((page - 1) * 25, page * 25)}
        warnings={warnings}
        mayManage={mayManage}
        summary={summary}
        timezone={organization.timezone}
      />
      <div className="mt-3 flex gap-4 text-sm">
        {page > 1 && <a href={href(page - 1)}>Previous</a>}
        {filtered.length > page * 25 && <a href={href(page + 1)}>Next</a>}
      </div>
    </div>
  );
}
