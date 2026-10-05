import {
  AnsweringNotEntitledError,
  type Answer,
  type AnsweringProvider,
  type AnsweringRequest,
  type ProposedAction,
  type ToolCallRecord,
} from './index';

/**
 * `apps/api`, as one implementation of the answering capability (D34) — the one call this
 * repository makes from one deployment to the other. Carries the operator's own token, performs
 * no write, and the far side holds no role or grant of its own (distinct from D30's frozen
 * direction: an action runtime calling back to write). Nothing is retried — a second attempt
 * nobody asked for is a second bill and a second copy of their data leaving.
 */
export function goldApiAnsweringProvider(config: { baseUrl: string }): AnsweringProvider {
  return {
    name: 'gold',

    async answer(input: AnsweringRequest): Promise<Answer> {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/ai/ask`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The caller's own token, forwarded rather than exchanged — the entire authorization model here.
          authorization: `Bearer ${input.token}`,
        },
        body: JSON.stringify({
          question: input.question,
          history: input.priorTurns,
          attachments: input.attachments,
          organization_id: input.organizationId,
          context: input.context,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
        if (response.status === 403 && body.code === 'not_entitled') throw new AnsweringNotEntitledError();
        throw new Error(body.error ?? `the assistant is unavailable (${response.status})`);
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
        answeredBy: body.answered_by ?? 'unknown',
        tools: body.tools ?? [],
        action: body.action ?? null,
      };
    },
  };
}
