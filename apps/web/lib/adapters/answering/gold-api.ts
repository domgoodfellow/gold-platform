import type {
  Answer,
  AnsweringProvider,
  AnsweringRequest,
  ProposedAction,
  ToolCallRecord,
} from './index';

/**
 * `apps/api`, as one implementation of the answering capability.
 *
 * **The one call this repository makes from one of its own deployments to the other**, and
 * `constraints.md` D34 is where that is argued. D30 froze the seam in the other direction — an
 * action runtime calling back into the operator application to write — and this is not that: it
 * carries the operator's own token, performs no write, and the far side holds no role, no key
 * and no grant with which it could do anything the caller could not.
 *
 * **Nothing is retried.** A question is asked by somebody watching, and a second attempt they
 * did not ask for is a second bill and a second copy of their data leaving. If it failed, they
 * press the button again.
 */
export function goldApiAnsweringProvider(config: { baseUrl: string }): AnsweringProvider {
  return {
    name: 'gold',

    async answer(input: AnsweringRequest): Promise<Answer> {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/ai/ask`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The caller's own, forwarded rather than exchanged. This is the entire
          // authorization model for everything that happens on the far side.
          authorization: `Bearer ${input.token}`,
        },
        body: JSON.stringify({ question: input.question }),
        // Long, because a model working through several tools is slow rather than broken; not
        // unbounded, because a request nobody ever answers holds a page open forever.
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        // The far side's own words where it gave any — a deployment with no model configured
        // says so here, which is the sentence the screen shows (D31).
        throw new Error(
          (body as { error?: string }).error ?? `the assistant is unavailable (${response.status})`,
        );
      }

      const body = (await response.json()) as {
        outcome?: string;
        answer?: string;
        detail?: string;
        answered_by?: string;
        tools?: ToolCallRecord[];
        action?: ProposedAction | null;
      };

      const outcome =
        body.outcome === 'answered' || body.outcome === 'unanswered' ? body.outcome : 'failed';

      return {
        outcome,
        text: body.answer ?? '',
        detail: outcome === 'failed' ? (body.detail || 'the assistant could not answer') : null,
        // Which model, rather than which deployment — `apps/api` reports the name of whoever it
        // asked, so a business that moved to its own hardware can see that in the record.
        answeredBy: body.answered_by ?? 'unknown',
        tools: body.tools ?? [],
        action: body.action ?? null,
      };
    },
  };
}
