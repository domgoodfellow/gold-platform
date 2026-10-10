import type { Execution } from './tool-access';

/** Plain words for what the database recorded. The codes are the record; these are only how it reads. */

const REFUSAL: Record<string, string> = {
  not_granted: 'Not given access',
  grant_revoked: 'Access was withdrawn',
  connection_inactive: 'The connection was not active',
  server_disabled: 'The server was switched off',
  tool_removed: 'The server no longer offers it',
  tool_not_enabled: 'The tool was not enabled',
  resource_unavailable: 'The item it was limited to is gone',
  resource_not_granted: 'It was limited to a different item',
  resource_not_readable_by_assistant: 'The agent may not read that item',
  principal_inactive: 'The agent or automation was off',
  invalid_arguments: 'The request was not usable',
  arguments_too_large: 'The request was too large',
  too_many_pending: 'Too many requests were waiting',
  access_denied: 'Access was denied',
};

const FAILURE: Record<string, string> = {
  provider_refused: 'The app refused it',
  unreachable: 'The app could not be reached',
  invalid_input: 'The request was not usable',
  credential_unavailable: 'No sign-in was available',
  timeout: 'It took too long',
  tool_error: 'The tool reported an error',
  unsupported: 'Not available here',
  internal: 'Something went wrong',
};

export type Outcome = { label: string; detail: string | null; tone: 'success' | 'danger' | 'neutral' };

export function outcomeOf(execution: Pick<Execution, 'status' | 'refusalReason' | 'errorClass'>): Outcome {
  switch (execution.status) {
    case 'succeeded':
      return { label: 'Done', detail: null, tone: 'success' };
    case 'running':
      return { label: 'Running', detail: null, tone: 'neutral' };
    case 'pending_approval':
      return { label: 'Waiting for approval', detail: null, tone: 'neutral' };
    case 'rejected':
      return { label: 'Rejected', detail: null, tone: 'neutral' };
    case 'expired':
      return { label: 'Expired', detail: 'Nobody decided in time', tone: 'neutral' };
    case 'refused':
      return { label: 'Refused', detail: REFUSAL[execution.refusalReason ?? ''] ?? null, tone: 'danger' };
    case 'failed':
      return { label: 'Failed', detail: FAILURE[execution.errorClass ?? ''] ?? null, tone: 'danger' };
  }
}

/** Which of a server's four separate facts hold, so a screen never folds them into one word. */
export function serverFacts(input: {
  connectionStatus: 'connecting' | 'active' | 'needs_attention' | 'disconnected' | undefined;
  discoveryStatus: 'never' | 'succeeded' | 'failed';
  enabled: boolean;
}) {
  return {
    connected: input.connectionStatus !== undefined && input.connectionStatus !== 'disconnected',
    discovered: input.discoveryStatus === 'succeeded',
    switchedOn: input.enabled,
    healthy: input.connectionStatus === 'active' && input.discoveryStatus === 'succeeded',
  };
}

export function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
