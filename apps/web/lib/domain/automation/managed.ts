import type { ModuleKey } from '@/lib/navigation';

/**
 * Automated work GildOps performs that a business did not write as a rule.
 *
 * **A register of what the code already does, never a store of anything.** Each entry names an
 * existing scheduled entry point or database trigger (`apps/api/vercel.json`, the migrations named
 * in `source`) and the surface that already owns its settings. Nothing here has a row, a status or
 * a history of its own: an entry shows facts that are true of the code, and links to the owner
 * that holds the real settings and records. Adding an entry means the behaviour already exists.
 *
 * Each entry does work for one business, inside that business's data. A member can see what it is
 * and where it is controlled; none can be edited as a workflow. The machinery behind them —
 * schedulers and outside services calling back — is listed only to GildOps platform staff
 * (`features/platform/operations/platform-processes.ts`, shown on Platform → Failures).
 *
 * Wording is read on screen and follows the words rule (`docs/ui-system.md` → Words we use).
 */

export type ManagedControl = {
  label: string;
  /** Organization-relative path; the page itself decides who may change anything there. */
  path: string;
};

export type ManagedAutomation = {
  key: string;
  name: string;
  purpose: string;
  /** When it runs, in plain words. */
  runs: string;
  /** The workspace that owns its settings and records. */
  owner: string;
  /** Where its settings live. None of them is the workflow editor. */
  controls: ManagedControl[];
  /** Where its results are recorded, when a member can read them. */
  records: ManagedControl | null;
  /** Shown only when the business has this feature switched on and paid for. */
  requiresModule?: ModuleKey;
  /** Code locations, for maintainers. Never rendered. */
  source: string[];
};

export const MANAGED_AUTOMATIONS: readonly ManagedAutomation[] = [
  {
    key: 'workflow-messages',
    name: 'Workflow message sending',
    purpose: 'Sends the messages your workflows queue, from your business’s verified sender address.',
    runs: 'About every 15 minutes',
    owner: 'Automations',
    controls: [
      { label: 'Message templates', path: 'automations/messages' },
      { label: 'Email sending', path: 'settings/email' },
    ],
    records: { label: 'Deliveries', path: 'automations/runs?stream=deliveries' },
    requiresModule: 'automations',
    source: ['apps/api/api/automation_tick.py', 'supabase/migrations/20260831000003_messages.sql'],
  },
  {
    key: 'timed-workflow-checks',
    name: 'Timed workflow checks',
    purpose:
      'Runs workflows that start before a job, on weather at a job or on a machine counter, once each is due. Weather is fetched only for locations a workflow watches.',
    runs: 'About every 15 minutes',
    owner: 'Automations',
    controls: [{ label: 'Workflows', path: 'automations/workflows' }],
    records: { label: 'Runs', path: 'automations/runs' },
    requiresModule: 'automations',
    source: [
      'apps/api/api/automation_tick.py',
      'supabase/migrations/20260831000004_scheduler.sql',
      'supabase/migrations/20260831000005_external_readings.sql',
      'supabase/migrations/20260831000006_counters.sql',
    ],
  },
  {
    key: 'connected-tool-calls',
    name: 'Connected tool calls',
    purpose: 'Makes the reads that “Use a connected tool” steps queue, through the connection the workflow was given.',
    runs: 'About every 15 minutes',
    owner: 'Connections',
    controls: [{ label: 'Connections', path: 'settings/connections' }],
    records: { label: 'Runs', path: 'automations/runs' },
    requiresModule: 'integrations',
    source: ['apps/api/api/automation_tick.py', 'supabase/migrations/20261022000068_integration_tools_follow_up.sql'],
  },
  {
    key: 'source-synchronization',
    name: 'Source synchronization',
    purpose: 'Refreshes connected spreadsheets and calendars that have synchronization switched on.',
    runs: 'About every 15 minutes',
    owner: 'Connections',
    controls: [{ label: 'Sources', path: 'library/sources' }],
    records: null,
    requiresModule: 'integrations',
    source: ['apps/api/api/integration_sync_tick.py', 'supabase/migrations/20261022000069_open_source_integration_library.sql'],
  },
  {
    key: 'service-update-emails',
    name: 'Service update emails',
    purpose:
      'Emails customer contacts who confirmed their address when a review is requested, an update is published or a review changes.',
    runs: 'About every minute',
    owner: 'CRM',
    controls: [{ label: 'Customers', path: 'crm/contacts' }],
    records: null,
    source: [
      'apps/api/api/customer_notification_tick.py',
      'supabase/migrations/20261022000078_customer_delivery_notifications.sql',
    ],
  },
];

export function managedAutomationsFor(usableModules: ReadonlySet<string>): ManagedAutomation[] {
  return MANAGED_AUTOMATIONS.filter((entry) => !entry.requiresModule || usableModules.has(entry.requiresModule));
}
