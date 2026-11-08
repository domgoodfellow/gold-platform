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
import { TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { SelectField } from '@/components/controls/select-field';

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
        <SelectField name="status" aria-label="Rule status" defaultValue={first('status') ?? ''} size="small" options={[{ value: '', label: 'All statuses' }, { value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }]} />
        <SelectField name="trigger" aria-label="Trigger kind" defaultValue={first('trigger') ?? ''} size="small" options={[{ value: '', label: 'All triggers' }, { value: 'event', label: 'Event' }, { value: 'schedule', label: 'Schedule' }, { value: 'external_reading', label: 'External reading' }, { value: 'counter_threshold', label: 'Counter threshold' }]} />
        <SelectField name="health" aria-label="Health" defaultValue={first('health') ?? ''} size="small" options={[{ value: '', label: 'All rules' }, { value: 'attention', label: 'Needs attention' }]} />
        <SelectField name="sort" aria-label="Sort rules" defaultValue={first('sort') ?? 'recent'} size="small" options={[{ value: 'recent', label: 'Newest first' }, { value: 'name', label: 'Name' }]} />
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
