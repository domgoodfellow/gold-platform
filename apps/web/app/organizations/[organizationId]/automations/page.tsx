import { listAutomationRules, listAutomationRuns } from '@/lib/domain/automation/rules';
import { reviewAutomationRules } from '@/lib/domain/automation/review';
import {
  listMessageDeliveries,
  listMessageTemplates,
} from '@/lib/domain/automation/templates';
import { listFieldDefinitions } from '@/lib/domain/fields/field-definitions';
import { listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { listWorkItemTypes } from '@/lib/domain/work-items/types';
import { requireOrganization } from '@/lib/route/organization';
import {
  AutomationRuleCard,
  CreateAutomationRuleForm,
  MessageTemplateSection,
} from './automation-forms';

export const dynamic = 'force-dynamic';

/**
 * What this business does when nobody is looking.
 *
 * Everything on this screen is a business's own rule, written in its own words about its own
 * statuses and its own fields. The platform supplies the grammar — when, if, then — and no
 * sentence. A business that has written nothing sees an empty list, not a suggestion.
 */
export default async function AutomationsPage({
  params,
}: PageProps<'/organizations/[organizationId]/automations'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [rules, types, definitions, runs, templates, deliveries] = await Promise.all([
    listAutomationRules(db, { organizationId }),
    listWorkItemTypes(db, { organizationId }),
    listFieldDefinitions(db, { organizationId, entityType: 'work_item' }),
    listAutomationRuns(db, { organizationId, limit: 25 }),
    listMessageTemplates(db, { organizationId }),
    listMessageDeliveries(db, { organizationId, limit: 25 }),
  ]);

  // A status belongs to a type (I20), and a rule is triggered by an event rather than by a kind
  // of work — so every status this business has is offerable, and which of them a job can
  // actually reach is decided at the moment the rule runs, by that type's own transitions (I13).
  const everyStatus = (
    await Promise.all(
      types.map(async (type) => {
        const own = await listWorkItemStatuses(db, { organizationId, typeId: type.id });
        return own.map((status) => ({
          id: status.id,
          typeId: type.id,
          name: status.name,
          typeName: type.name,
          label: `${type.name} — ${status.name}`,
        }));
      }),
    )
  ).flat();

  const statuses = everyStatus.map((status) => ({ id: status.id, label: status.label }));

  // **What is wrong with these rules, before anything runs.** The failures this catches are the
  // ones nothing else can see: a rule that never fires produces no failed run, because nothing
  // happened. Silence looks exactly like a business having nothing to do.
  const warnings = await reviewAutomationRules(db, { organizationId, rules, statuses: everyStatus });

  const mayManage = organization.capabilities.includes('automation.manage');

  return (
    <>
      <p className="mt-6 max-w-2xl text-sm opacity-70">
        A rule watches for something happening, checks whether the job looks the way you describe,
        and then does something. Every condition has to hold — two rules is how you say
        &ldquo;or&rdquo;. Nothing here runs on a job this business has not already agreed can move
        that way: a rule is refused by the same lifecycle a person is, and the refusal is recorded
        below.
      </p>

      {rules.length === 0 ? (
        <p className="mt-6 text-sm opacity-70">
          No rules yet. Nothing happens on its own until this business says it should.
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {rules.map((rule) => (
            <AutomationRuleCard
              key={rule.id}
              organizationId={organizationId}
              rule={rule}
              statuses={statuses}
              templates={templates}
              types={types}
              definitions={definitions}
              runs={runs.filter((run) => run.ruleId === rule.id).slice(0, 5)}
              warnings={warnings
                .filter((warning) => warning.ruleId === rule.id)
                .map((warning) => warning.message)}
              mayManage={mayManage}
            />
          ))}
        </div>
      )}

      {mayManage ? (
        <CreateAutomationRuleForm organizationId={organizationId} />
      ) : (
        <p className="mt-8 text-sm opacity-70">
          Your role, {organization.role}, cannot write rules here. You can see what they are and
          what they have done, because a job that moves on its own should never be a mystery.
        </p>
      )}

      <MessageTemplateSection
        organizationId={organizationId}
        templates={templates}
        deliveries={deliveries}
        mayManage={mayManage}
        role={organization.role}
      />

      {runs.length > 0 ? (
        <section className="mt-10 border-t border-black/10 pt-6 dark:border-white/15">
          <h2 className="text-sm font-medium">What the rules have done</h2>
          <p className="mt-1 text-sm opacity-70">
            Newest first. A rule that did not apply records nothing — what is here is what
            happened.
          </p>
          <ul className="mt-2 divide-y divide-black/10 dark:divide-white/15">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
                <span className="opacity-60">
                  {new Date(run.occurredAt).toLocaleString('en-GB')}
                </span>
                <span className="font-medium">{run.ruleName}</span>
                {run.outcome === 'failed' ? (
                  <span className="text-red-600 dark:text-red-400">
                    failed — {run.detail}
                  </span>
                ) : (
                  <span className="opacity-70">ran</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
