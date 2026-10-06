import type { Capability } from './capabilities';

/**
 * Starting points for a new role — **templates, not classifications.** Choosing one fills the
 * capability checklist; what is saved is an ordinary organization role (`roles` row) holding an
 * ordinary list of capabilities, with no reference back to the preset. So a preset cannot be
 * "edited out from under" the roles made from it, a business can rename or reshape any of them,
 * and nothing anywhere asks which preset a role came from. Behaviour checks capabilities, never a
 * role's name (I12) — a preset only saves somebody ticking eleven boxes.
 *
 * These are the platform's suggestions, not a vocabulary a business must use: a two-person company
 * may need one role, a forty-person one eight, and a financial-sales business will name its own.
 */
export type RolePreset = { key: string; label: string; capabilities: readonly Capability[] };

export const ROLE_PRESETS: readonly RolePreset[] = [
  {
    key: 'administrator',
    label: 'Administrator',
    capabilities: [
      'customer.create', 'customer.update', 'role.manage', 'field.manage', 'location.create', 'resource.create',
      'resource.update', 'work_item.create', 'asset.create', 'document.create', 'work_item.transition', 'work_item.schedule',
      'work_item.record', 'organization.manage', 'price.manage', 'work_item.price', 'work_item.update',
      'invoice.issue', 'payment.record', 'automation.manage', 'configuration.propose', 'assistant.ask',
      'report.read', 'report.manage', 'call.place', 'message.send', 'integration.manage', 'feature.manage', 'billing.manage', 'secret.manage',
    ],
  },
  {
    key: 'manager',
    label: 'Manager',
    capabilities: [
      'customer.create', 'customer.update', 'location.create', 'resource.create', 'resource.update', 'work_item.create',
      'asset.create', 'document.create', 'work_item.transition', 'work_item.schedule', 'work_item.record',
      'work_item.price', 'work_item.update', 'invoice.issue', 'payment.record', 'assistant.ask', 'report.read', 'call.place', 'message.send',
    ],
  },
  {
    key: 'sales',
    label: 'Sales',
    capabilities: ['customer.create', 'customer.update', 'call.place', 'message.send', 'document.create', 'assistant.ask', 'report.read'],
  },
  {
    key: 'support',
    label: 'Support',
    capabilities: ['customer.create', 'customer.update', 'call.place', 'message.send', 'document.create', 'work_item.create', 'assistant.ask'],
  },
  {
    key: 'dispatcher',
    label: 'Dispatcher',
    capabilities: ['customer.update', 'work_item.create', 'work_item.transition', 'work_item.schedule', 'work_item.update', 'resource.create', 'resource.update'],
  },
  {
    key: 'technician',
    label: 'Technician',
    capabilities: ['work_item.transition', 'work_item.record', 'document.create'],
  },
  { key: 'viewer', label: 'Viewer', capabilities: [] },
];
