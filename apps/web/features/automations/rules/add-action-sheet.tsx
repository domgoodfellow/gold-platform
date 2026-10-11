'use client';

import { useActionState, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerDescription,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import {
  ACTION_KINDS,
  type AutomationRule,
} from '@/lib/domain/automation/rules';
import {
  CHANNELS,
  type MessageTemplate,
} from '@/lib/domain/automation/templates';
import type { StatusChoice } from './rule-detail-types';
import { addActionAction, addToolActionAction } from '@/app/organizations/[organizationId]/automations/actions';
import type { ToolChoice } from '@/lib/domain/integrations/tool-access';
import {
  ActionError,
  INITIAL_AUTOMATION_ACTION_STATE as INITIAL,
} from '../shared';

export function AddActionSheet({
  organizationId,
  rule,
  statuses,
  templates,
  types,
  action,
  toolChoices = [],
}: {
  action?: AutomationRule['actions'][number];
  organizationId: string;
  rule: AutomationRule;
  statuses: StatusChoice[];
  templates: MessageTemplate[];
  types: { id: string; name: string }[];
  /** What a connected app can be asked to read. Empty for someone who may not wire one in. */
  toolChoices?: ToolChoice[];
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(
    action?.kind ??
      (rule.triggerKind === 'counter_threshold'
        ? 'create_work_item'
        : 'change_status'),
  );
  const [choice, setChoice] = useState('');
  const chosen = (() => {
    const [connectionId, capabilityKey] = choice.split('|');
    const connection = toolChoices.find((entry) => entry.connectionId === connectionId);
    return connection
      ? { connection, capability: connection.capabilities.find((entry) => entry.key === capabilityKey) ?? null }
      : null;
  })();
  const [state, formAction, pending] = useActionState(
    async (previous: typeof INITIAL, data: FormData) => {
      const result = kind === 'run_tool' ? await addToolActionAction(previous, data) : await addActionAction(previous, data);
      if (!result.error) setOpen(false);
      return result;
    },
    INITIAL,
  );

  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" tone="secondary" size="small">
          <Plus aria-hidden className="size-4" />{' '}
          {action ? 'Edit action' : 'Add action'}
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>
            {action ? 'Edit action' : 'Add an action'}
          </PageDrawerTitle>
          <PageDrawerDescription>
            Actions run in the displayed order. Saving replaces this
            configuration atomically.
          </PageDrawerDescription>
        </PageDrawerHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="ruleId" value={rule.id} />
          {action && <input type="hidden" name="actionId" value={action.id} />}

          <SelectInput
            name="kind"
            aria-label="What to do"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            {ACTION_KINDS.filter(
              (entry) =>
                (rule.triggerKind !== 'counter_threshold' ||
                  entry.kind === 'create_work_item') &&
                (entry.kind !== 'run_tool' || (toolChoices.length > 0 && !action)),
            ).map((entry) => (
              <option key={entry.kind} value={entry.kind}>
                {entry.label}
              </option>
            ))}
          </SelectInput>

          {kind === 'run_tool' && (
            <>
              <SelectInput
                name="choice"
                aria-label="What to read"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                required
              >
                <option value="">Choose what to read</option>
                {toolChoices.map((connection) => (
                  <optgroup
                    key={connection.connectionId}
                    label={`${connection.connectorName}${connection.accountLabel ? ` — ${connection.accountLabel}` : ''}`}
                  >
                    {connection.capabilities.map((capability) => (
                      <option key={capability.key} value={`${connection.connectionId}|${capability.key}`}>
                        {capability.summary}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </SelectInput>
              <input type="hidden" name="connectorName" value={chosen?.connection.connectorName ?? ''} />
              {chosen?.capability?.fields.map((field) => (
                <label key={field.name} className="flex flex-col gap-1 text-sm">
                  {field.label}
                  {field.required ? '' : ' (optional)'}
                  <TextInput
                    name={`arg_${field.name}`}
                    type={field.kind === 'whole number' ? 'number' : 'text'}
                    required={field.required}
                    autoComplete="off"
                  />
                </label>
              ))}
              <p className="text-xs text-subtle">
                The rule reads this when it runs and records whether it worked. It only reads; it changes nothing in the app, and what it read is
                not kept. Adding it gives this rule the right to use that connection. Withdraw that by removing the action.
              </p>
            </>
          )}

          {(kind === 'change_status' || kind === 'create_work_item') && (
            <SelectInput
              name="statusId"
              aria-label="Status"
              defaultValue={action?.statusId ?? ''}
              required
            >
              <option value="">Choose a Work status</option>
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </SelectInput>
          )}

          {kind === 'notify' && (
            <>
              <SelectInput
                name="templateId"
                aria-label="Message"
                defaultValue={action?.templateId ?? ''}
                required
              >
                <option value="">Choose a message template</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </SelectInput>

              <SelectInput
                name="channel"
                aria-label="How to reach them"
                defaultValue={action?.channel ?? 'email'}
              >
                {CHANNELS.map((entry) => (
                  <option key={entry.channel} value={entry.channel}>
                    {entry.label}
                  </option>
                ))}
              </SelectInput>
              <p className="text-xs text-subtle">
                Recipient: the Customer associated with the triggering Work
                item. Sending requires a configured provider.
              </p>
            </>
          )}

          {kind === 'create_work_item' && (
            <SelectInput
              name="typeId"
              aria-label="Kind of work"
              defaultValue={action?.typeId ?? ''}
              required
            >
              <option value="">Choose a Work type</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </SelectInput>
          )}

          {/* Signed, and negative brings a job forward. */}
          {kind === 'shift_schedule' && (
            <>
              <p className="text-xs text-subtle">
                Signed minutes: negative moves Work earlier, positive moves it
                later. Availability and overlap constraints still apply.
              </p>
              <TextInput
                name="shiftMinutes"
                type="number"
                min={-20160}
                max={20160}
                step={1}
                defaultValue={action?.shiftMinutes ?? 1440}
                aria-label="Minutes to move it by"
              />
            </>
          )}

          {statuses.length === 0 && (kind === 'change_status' || kind === 'create_work_item') ? (
            <span className="text-xs text-muted">
              This business has no statuses yet, so there is nowhere for a rule
              to move a job.
            </span>
          ) : null}

          {templates.length === 0 && kind === 'notify' ? (
            <span className="text-xs text-muted">
              No messages written yet, so there is nothing to send.
            </span>
          ) : null}

          <Button type="submit" disabled={pending} className="w-fit">
            {pending ? 'Saving...' : action ? 'Save action' : 'Add action'}
          </Button>
          <ActionError state={state} />
        </form>
      </PageDrawerContent>
    </PageDrawer>
  );
}
