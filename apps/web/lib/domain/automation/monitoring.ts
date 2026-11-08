import type { Db } from '@/lib/db/types';
import { fromDatabaseError } from '@/lib/domain/errors';

export type AutomationSummary = {
  runs: number;
  failed: number;
  deliveries: Partial<Record<'queued' | 'sent' | 'failed', number>>;
  days: { day: string; total: number; failed: number }[];
  rules: {
    rule_id: string;
    total: number;
    failed: number;
    last_id: string;
    last_at: string;
    last_outcome: string;
  }[];
};

export async function presentAutomationRuleIds(
  db: Db,
  input: { organizationId: string; ids: string[] },
): Promise<string[]> {
  if (!input.ids.length) return [];
  const { data, error } = await db
    .from('automation_rules')
    .select('id')
    .eq('organization_id', input.organizationId)
    .in('id', input.ids);
  if (error) throw fromDatabaseError(error, 'automations.list_failed');
  return (data ?? []).map((row) => row.id);
}

export async function getAutomationSummary(
  db: Db,
  input: { organizationId: string; since: string; until: string },
): Promise<AutomationSummary> {
  const { data, error } = await db.rpc('automation_operating_summary', {
    p_organization_id: input.organizationId,
    p_since: input.since,
    p_until: input.until,
  });
  if (error) throw fromDatabaseError(error, 'automations.summary_failed');
  return data as unknown as AutomationSummary;
}

export async function readAutomationCollection<T>(
  read: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await read(offset, offset + 499);
    if (error)
      throw fromDatabaseError(error, 'automations.collection_failed');
    result.push(...(data ?? []));
    if ((data?.length ?? 0) < 500) return result;
  }
}
