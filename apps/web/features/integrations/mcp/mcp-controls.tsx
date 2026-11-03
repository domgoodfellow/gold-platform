'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormField } from '@/components/controls/form';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/controls/confirm-submit';
import {
  addMcpServerAction,
  decideExecutionAction,
  grantToolAction,
  reviewMcpToolAction,
  rediscoverMcpServerAction,
  revokeToolGrantAction,
  setMcpServerEnabledAction,
} from '@/app/organizations/[organizationId]/settings/connections/tool-actions';
import { TOOL_INITIAL, type ToolState } from './tool-state';
import type { McpTool } from '@/lib/domain/integrations/mcp';
import type { Agent } from '@/lib/domain/integrations/tool-access';
import { SelectField } from '@/components/controls/select-field';

type Action = (previous: ToolState, formData: FormData) => Promise<ToolState>;

function Feedback({ state }: { state: ToolState }) {
  return (
    <>
      <ErrorText role="alert">{state.error}</ErrorText>
      {state.notice ? <Hint role="status">{state.notice}</Hint> : null}
    </>
  );
}

/** A one-button form that carries its fields as hidden inputs. */
function ActionForm({
  action,
  fields,
  label,
  pendingLabel,
  tone = 'secondary',
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  tone?: 'primary' | 'secondary' | 'danger' | 'text';
}) {
  const [state, formAction, pending] = useActionState(action, TOOL_INITIAL);
  return (
    <form action={formAction}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" tone={tone} size="small" disabled={pending}>
        {pending ? (pendingLabel ?? `${label}…`) : label}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function AddServerDialog({ organizationId }: { organizationId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(async (previous: ToolState, formData: FormData) => {
    const result = await addMcpServerAction(previous, formData);
    if (result.notice) setOpen(false);
    return result;
  }, TOOL_INITIAL);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="small">
          Add a server
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <DialogHeader>
            <DialogTitle>Add an MCP server</DialogTitle>
            <DialogDescription>
              GildOps will connect, list what the server offers and stop there. Nothing the server offers can be used until you have reviewed it and
              given it to an agent.
            </DialogDescription>
          </DialogHeader>
          <FormField id="mcp-name" label="Name" hint="What you will call it here.">
            {(control) => <TextInput {...control} name="name" maxLength={120} required autoComplete="off" />}
          </FormField>
          <FormField id="mcp-endpoint" label="Address" hint="A public https address. Private and local addresses are refused.">
            {(control) => <TextInput {...control} name="endpoint" type="url" required placeholder="https://example.com/mcp" autoComplete="off" />}
          </FormField>
          <FormField
            id="mcp-bearer"
            label="Access token"
            optional
            hint="Sent to the server as a bearer token. It is stored securely and cannot be read back, here or anywhere."
          >
            {(control) => <TextInput {...control} name="bearer" type="password" autoComplete="off" spellCheck={false} />}
          </FormField>
          <ErrorText role="alert">{state.error}</ErrorText>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" tone="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? 'Connecting…' : 'Add server'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TestServerForm({ organizationId, connectionId }: { organizationId: string; connectionId: string }) {
  return (
    <ActionForm
      action={rediscoverMcpServerAction}
      fields={{ organizationId, connectionId }}
      label="Test and refresh"
      pendingLabel="Testing…"
    />
  );
}

export function ServerSwitch({ organizationId, serverId, enabled }: { organizationId: string; serverId: string; enabled: boolean }) {
  return (
    <ActionForm
      action={setMcpServerEnabledAction}
      fields={{ organizationId, serverId, enabled: enabled ? 'false' : 'true' }}
      label={enabled ? 'Switch off' : 'Switch on'}
    />
  );
}

/** Review one tool: say what kind it is, then offer it or withdraw it. Enabling is a separate act from discovering. */
export function ToolReviewForm({ organizationId, tool }: { organizationId: string; tool: McpTool }) {
  const [state, formAction, pending] = useActionState(reviewMcpToolAction, TOOL_INITIAL);
  const removed = tool.status === 'removed';
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="toolId" value={tool.id} />
      <SelectField size="small" name="classification" aria-label={`What kind of tool ${tool.name} is`} defaultValue={tool.classification} disabled={pending || removed} options={[{ value: 'unreviewed', label: 'Not reviewed', disabled: true }, { value: 'read', label: 'Only reads' }, { value: 'write', label: 'Can change things' }]} />
      {tool.enabled ? (
        <Button type="submit" name="enabled" value="false" tone="secondary" size="small" disabled={pending}>
          Disable
        </Button>
      ) : (
        <Button type="submit" name="enabled" value="true" tone="primary" size="small" disabled={pending || removed}>
          Enable
        </Button>
      )}
      <Feedback state={state} />
    </form>
  );
}

/** Give one agent access to a tool or capability. Absent by default; an MCP tool always asks a person first. */
export function GrantForm({
  organizationId,
  agents,
  target,
  alwaysAsks,
  resources,
  everyAgentHasIt,
}: {
  organizationId: string;
  /** Only agents that do not already hold it; the caller has filtered. */
  agents: Agent[];
  everyAgentHasIt?: boolean;
  target: { mcpToolId: string } | { connectionId: string; capabilityKey: string };
  alwaysAsks?: boolean;
  /** For a capability that works on one resource at a time: offered so access can be narrowed to one. */
  resources?: { id: string; label: string }[];
}) {
  const [state, formAction, pending] = useActionState(grantToolAction, TOOL_INITIAL);
  const id = 'mcpToolId' in target ? target.mcpToolId : `${target.connectionId}-${target.capabilityKey}`;
  if (agents.length === 0) {
    return everyAgentHasIt ? null : <Hint>Turn on the operator agent in AI to give it access.</Hint>;
  }
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      {'mcpToolId' in target ? (
        <input type="hidden" name="mcpToolId" value={target.mcpToolId} />
      ) : (
        <>
          <input type="hidden" name="connectionId" value={target.connectionId} />
          <input type="hidden" name="capabilityKey" value={target.capabilityKey} />
        </>
      )}
      <SelectField size="small" name="agentId" aria-label="Agent" defaultValue={agents[0]?.id} disabled={pending} options={[...agents.map((agent) => ({ value: agent.id, label: agent.name }))]} />
      {resources && resources.length > 0 ? (
        <SelectField size="small" name="resourceId" aria-label="Limit to" defaultValue="" disabled={pending} options={[{ value: '', label: 'Everything it can reach' }, ...resources.map((resource) => ({ value: resource.id, label: resource.label }))]} />
      ) : null}
      {alwaysAsks ? (
        <Hint className="whitespace-nowrap">A person approves every use.</Hint>
      ) : (
        <label htmlFor={`approval-${id}`} className="flex items-center gap-1 text-sm">
          <input id={`approval-${id}`} type="checkbox" name="requiresApproval" /> Ask a person first
        </label>
      )}
      <Button type="submit" size="small" tone="secondary" disabled={pending}>
        {pending ? 'Granting…' : 'Give access'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function RevokeGrantForm({
  organizationId,
  grantId,
  connectionId,
  agentName,
}: {
  organizationId: string;
  grantId: string;
  connectionId?: string;
  agentName: string;
}) {
  const [state, formAction, pending] = useActionState(revokeToolGrantAction, TOOL_INITIAL);
  return (
    <form action={formAction} className="inline-flex items-center gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="grantId" value={grantId} />
      <input type="hidden" name="connectionId" value={connectionId ?? ''} />
      <Button type="submit" tone="secondary" size="tiny" disabled={pending}>
        {pending ? 'Withdrawing…' : 'Withdraw'}
        <span className="sr-only"> access from {agentName}</span>
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export type WaitingRequest = { id: string; title: string; asked: string; sent: string };

/**
 * Requests waiting for a person. One form serves every row, so the answer ("Approved and run.") stays on
 * screen after the row itself has gone from the list: the list is read from the database and a decided
 * request is no longer in it.
 */
export function ApprovalQueue({ organizationId, requests, mayManage }: { organizationId: string; requests: WaitingRequest[]; mayManage: boolean }) {
  const [state, formAction, pending] = useActionState(decideExecutionAction, TOOL_INITIAL);
  if (requests.length === 0 && !state.notice && !state.error) return null;

  return (
    <div className="mt-2">
      {requests.length > 0 ? (
        <ul className="divide-y divide-border">
          {requests.map((request) => (
            <li key={request.id} className="py-3">
              <form action={formAction} className="flex flex-wrap items-start justify-between gap-3">
                <input type="hidden" name="organizationId" value={organizationId} />
                <input type="hidden" name="executionId" value={request.id} />
                <div className="min-w-0">
                  <p className="font-medium">{request.title}</p>
                  <p className="break-words text-sm text-muted">Asked {request.asked}. It will not run unless you approve it.</p>
                  {request.sent ? <p className="mt-1 break-all rounded bg-surface px-2 py-1 font-mono text-xs text-muted">{request.sent}</p> : null}
                </div>
                {mayManage ? (
                  <FormActions>
                    <Button type="submit" name="approve" value="true" size="small" disabled={pending}>
                      {pending ? 'Working…' : 'Approve and run'}
                    </Button>
                    <Button type="submit" name="approve" value="false" tone="secondary" size="small" disabled={pending}>
                      Reject
                    </Button>
                  </FormActions>
                ) : null}
              </form>
            </li>
          ))}
        </ul>
      ) : null}
      <Feedback state={state} />
    </div>
  );
}
