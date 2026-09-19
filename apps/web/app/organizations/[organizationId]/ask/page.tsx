import { ErrorText, Hint } from '@/components/controls/inputs';
import { PageHeader } from '@/components/containers/page-header';
import { EmptyState, SectionHeading } from '@/components/containers/section';
import { canAnswerQuestions, listAgentRuns } from '@/lib/domain/assistant/questions';
import { areaLabel } from '@/lib/navigation';
import { requireOrganization } from '@/lib/route/organization';
import { AskForm, ProposedAction } from './ask-form';

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
      <PageHeader
        title={areaLabel('ask')}
        description="Answers are built from what you can already see on the other screens. Nothing here changes anything."
      />

      {/* **Where the data goes, said on the screen that sends it.**
          This is the only feature in the platform that sends a business's rows anywhere, so it is
          the only screen that has to say so — in the platform's own voice about application
          state, which is the one thing it may describe (D34).

          A `<details>` rather than a hover tooltip: a tooltip is unreachable on a phone, invisible
          to a keyboard, and this is exactly the sentence somebody needs on the device they are
          standing on a site with. No JavaScript, so it works on a server-rendered page. */}
      <details className="group mt-2 max-w-2xl text-xs text-muted">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5">
          <span
            aria-hidden="true"
            className="grid h-4 w-4 place-items-center rounded-full border border-current text-[10px] leading-none"
          >
            ?
          </span>
          <span className="underline underline-offset-2">Where your question goes</span>
        </summary>

        <div className="mt-2 space-y-2 border-l border-border pl-3">
          <p>
            Your question, and the rows read to answer it, are sent to whichever model this
            installation is set up with. Each answer below records which one replied.
          </p>
          <p>
            A model running on this installation&rsquo;s own hardware sends nothing outside it. A
            hosted one does, and a <strong>free tier is usually free because the provider may keep
            what it receives and train on it</strong> — which makes it suitable for trying this out
            and not for a real customer&rsquo;s details. Whoever runs this installation chooses,
            and can tell you which it is.
          </p>
          <p>
            A model is never shown more than you can see yourself: every answer is assembled under
            your own sign-in, from the same records these screens show you.
          </p>
        </div>
      </details>

      {!canAnswer && (
        <p className="mt-4 max-w-2xl rounded border border-border p-3 text-sm">
          This installation has nothing configured to answer questions, so nothing can be asked
          here yet. Everything it would look at is on the Work and Schedule screens.
        </p>
      )}

      {canAnswer && !mayAsk && (
        <p className="mt-4 max-w-2xl rounded border border-border p-3 text-sm">
          Your role, {organization.role}, cannot ask the platform questions.
        </p>
      )}

      {canAnswer && <AskForm organizationId={organizationId} disabled={!mayAsk} />}

      <section className="mt-8 max-w-2xl">
        <SectionHeading>What you have asked</SectionHeading>

        {runs.length === 0 ? (
          <EmptyState className="mt-2">Nothing yet.</EmptyState>
        ) : (
          <ul className="mt-2 space-y-4">
            {runs.map((run) => (
              <li
                key={run.id}
                className="rounded border border-border p-3 text-sm"
              >
                <p className="font-medium">{run.question}</p>

                {run.outcome === 'answered' && (
                  <p className="mt-2 whitespace-pre-wrap">{run.answer}</p>
                )}

                {run.outcome === 'unanswered' && (
                  <EmptyState className="mt-2">
                    Nothing came back for this one. Nothing went wrong — there was no answer to be
                    had from what this platform can look at.
                  </EmptyState>
                )}

                {/* Whoever refused, in their own words. Never a paraphrase (I25). */}
                {run.outcome === 'failed' && (
                  <ErrorText className="mt-2">{run.detail}</ErrorText>
                )}

                <ProposedAction organizationId={organizationId} run={run} />

                <Hint weight="subtle" className="mt-2 text-xs">
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
                </Hint>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
