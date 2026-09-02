import { canAnswerQuestions, listAgentRuns } from '@/lib/domain/assistant/questions';
import { requireOrganization } from '@/lib/route/organization';
import { AskForm } from './ask-form';

export const dynamic = 'force-dynamic';

/**
 * Ask the system a question, and see what was asked before.
 *
 * **Everything on this screen is a read, and the answer was built under your own session.** The
 * tools that produced it are functions in Postgres running as the person who asked
 * (`constraints.md` D34), so what an answer can contain is exactly what the other screens would
 * show that person — no more, and no less because somebody at the business holds a different
 * role.
 *
 * **The history is yours alone.** `agent_runs_select` narrows to whoever asked, which is the one
 * place this platform departs from "a member sees their business's rows": an answer holds
 * whatever its asker could see, and a portal customer's narrowing or a colleague's reach are not
 * the same. That is a policy rather than a filter on this page.
 */
export default async function AskPage({
  params,
}: PageProps<'/organizations/[organizationId]/ask'>) {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  const [runs, canAnswer] = await Promise.all([
    listAgentRuns(db, { organizationId }),
    canAnswerQuestions(),
  ]);

  // Shown rather than hidden, and refused by the database either way (I12). What this decides
  // is whether the box is usable, and the sentence beside it says why not — a disabled control
  // with no explanation is the silence D31 was written about.
  const mayAsk = organization.capabilities.includes('assistant.ask');

  return (
    <>
      <p className="mt-6 max-w-2xl text-sm opacity-70">
        Answers are built from what you can already see on the other screens. Nothing here changes
        anything.
      </p>

      {!canAnswer && (
        <p className="mt-4 max-w-2xl rounded border border-black/15 p-3 text-sm dark:border-white/20">
          This installation has nothing configured to answer questions, so nothing can be asked
          here yet. Everything it would look at is on the Work and Schedule screens.
        </p>
      )}

      {canAnswer && !mayAsk && (
        <p className="mt-4 max-w-2xl rounded border border-black/15 p-3 text-sm dark:border-white/20">
          Your role, {organization.role}, cannot ask the platform questions.
        </p>
      )}

      {canAnswer && <AskForm organizationId={organizationId} disabled={!mayAsk} />}

      <section className="mt-8 max-w-2xl">
        <h2 className="text-sm font-medium">What you have asked</h2>

        {runs.length === 0 ? (
          <p className="mt-2 text-sm opacity-70">Nothing yet.</p>
        ) : (
          <ul className="mt-2 space-y-4">
            {runs.map((run) => (
              <li
                key={run.id}
                className="rounded border border-black/15 p-3 text-sm dark:border-white/20"
              >
                <p className="font-medium">{run.question}</p>

                {run.outcome === 'answered' && (
                  <p className="mt-2 whitespace-pre-wrap">{run.answer}</p>
                )}

                {run.outcome === 'unanswered' && (
                  <p className="mt-2 opacity-70">
                    Nothing came back for this one. Nothing went wrong — there was no answer to be
                    had from what this platform can look at.
                  </p>
                )}

                {/* Whoever refused, in their own words. Never a paraphrase (I25). */}
                {run.outcome === 'failed' && (
                  <p className="mt-2 text-red-600 dark:text-red-400">{run.detail}</p>
                )}

                <p className="mt-2 text-xs opacity-60">
                  {new Date(run.occurredAt).toLocaleString()} · answered by {run.answeredBy}
                  {run.tools.length > 0 && (
                    <>
                      {' · '}
                      {run.tools
                        .map(
                          (call) =>
                            `${call.tool}${call.error ? ' (refused)' : ` — ${call.rows} rows`}`,
                        )
                        .join(', ')}
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
