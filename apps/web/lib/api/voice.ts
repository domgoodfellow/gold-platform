import { callDomainCommand } from './client';

/**
 * Writing up how a call went, authoritative in
 * `apps/api/app/domains/communications/voice/wrap_up.py`.
 *
 * **Replaces `recordCallOutcome`, formerly in `lib/domain/reception/calls.ts`.** That function
 * wrote the `calls` row and its `events` row as two separate requests; `record_call_outcome`
 * (the Postgres function this calls through `apps/api`) performs both in one transaction. There
 * is now exactly one implementation of this act, and it is this one.
 */
export type WrapUpCallResult = {
  callId: string;
  outcomeId: string | null;
  status: string;
};

export async function wrapUpCall(input: {
  token: string;
  organizationId: string;
  callId: string;
  outcomeId: string | null;
  note: string;
  durationSeconds: number | null;
}): Promise<WrapUpCallResult> {
  const result = await callDomainCommand<{
    call_id: string;
    outcome_id: string | null;
    status: string;
  }>('/voice/wrap-up-call', {
    token: input.token,
    body: {
      organization_id: input.organizationId,
      call_id: input.callId,
      outcome_id: input.outcomeId,
      note: input.note,
      duration_seconds: input.durationSeconds,
    },
  });

  return { callId: result.call_id, outcomeId: result.outcome_id, status: result.status };
}
