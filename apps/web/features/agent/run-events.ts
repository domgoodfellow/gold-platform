import type { AgentRun } from '@/lib/domain/assistant/questions';

export type RunEvent = {
  key: string;
  kind: 'checked' | 'refused' | 'done' | 'failed' | 'declined';
  text: string;
};

/**
 * The concise, non-speech events of one run, in the words a person would use — never a tool-call
 * audit trail. The recorded tool facts stay on the run; this says only what materially helps read
 * the answer beside it: how much was looked at, and whether anything was refused.
 */
export function runEvents(run: AgentRun): RunEvent[] {
  const events: RunEvent[] = [];

  const succeeded = run.tools.filter((call) => !call.error);
  if (succeeded.length > 0) {
    const rows = succeeded.reduce((sum, call) => sum + call.rows, 0);
    events.push({ key: 'checked', kind: 'checked', text: `Checked ${rows} ${rows === 1 ? 'record' : 'records'}` });
  }
  if (run.tools.some((call) => call.error)) {
    events.push({ key: 'refused', kind: 'refused', text: 'Tool refused' });
  }
  if (run.actionOutcome === 'done') {
    events.push({ key: 'action', kind: 'done', text: 'Action completed' });
  } else if (run.actionOutcome === 'failed') {
    events.push({
      key: 'action',
      kind: 'failed',
      text: run.actionDetail ? `Action failed: ${run.actionDetail}` : 'Action failed',
    });
  } else if (run.actionOutcome === 'declined') {
    events.push({ key: 'action', kind: 'declined', text: 'Action declined' });
  }
  return events;
}
