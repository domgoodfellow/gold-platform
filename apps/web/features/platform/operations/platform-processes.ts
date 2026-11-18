/**
 * The scheduled entry points (`apps/api/vercel.json`), database triggers and outside callbacks that
 * do automated work. Platform staff only: a business sees the work these do for it as managed
 * automations (`lib/domain/automation/managed.ts`), never this machinery.
 */
export type PlatformProcess = {
  name: string;
  entry: string;
  runs: string;
  does: string;
};

/** The scheduled entry points and outside callbacks, for platform staff. */
export const PLATFORM_PROCESSES: readonly PlatformProcess[] = [
  { name: 'Automation clock', entry: '/tasks/automation-tick', runs: 'Every 15 minutes', does: 'Fetches weather for watched locations, runs due timed workflows, sends queued workflow messages, makes queued connected tool calls and clears old call records.' },
  { name: 'Customer notifications', entry: '/tasks/customer-notifications', runs: 'Every minute', does: 'Sends queued service update emails and address confirmations.' },
  { name: 'Source synchronization', entry: '/tasks/integration-sync', runs: 'Every 15 minutes', does: 'Refreshes connected sources that are due.' },
  { name: 'Event workflows', entry: 'Database trigger on events', runs: 'On every recorded event', does: 'Runs a business’s event workflows inside the change that caused them.' },
  { name: 'Counter workflows', entry: 'Database trigger on asset readings', runs: 'On every machine reading', does: 'Runs counter workflows when a machine crosses its interval.' },
  { name: 'Card payment callbacks', entry: '/webhooks/stripe', runs: 'When Stripe calls back', does: 'Records customer payments.' },
  { name: 'Plan billing callbacks', entry: '/webhooks/stripe-platform-billing', runs: 'When Stripe calls back', does: 'Records what businesses pay GildOps.' },
  { name: 'Email delivery callbacks', entry: '/webhooks/tenant-email, /webhooks/invitation-email', runs: 'When the email service calls back', does: 'Records delivery, bounces and complaints.' },
  { name: 'Calling and text callbacks', entry: '/voice/*, /sms/*', runs: 'When Twilio calls back', does: 'Routes calls and texts and records their outcome.' },
];
