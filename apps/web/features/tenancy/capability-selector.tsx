'use client';

import { useState } from 'react';
import { Button } from '@/components/controls/button';
import { Hint } from '@/components/controls/inputs';
import { Badge } from '@/components/display/data';
import { CAPABILITIES, CAPABILITY_LABELS, SENSITIVE_CAPABILITIES, type Capability } from '@/lib/domain/tenancy/capabilities';

/**
 * The one grouping of `CAPABILITIES` for a human reading a checkbox list — not a second
 * vocabulary, just an arrangement of the platform one. A capability added to `capabilities.ts`
 * with no entry here fails `capability-selector.test.ts`, the same way an area with no module
 * fails `navigation.test.ts`.
 */
const GROUPS: readonly { label: string; capabilities: readonly Capability[] }[] = [
  { label: 'Contacts', capabilities: ['customer.create', 'customer.update'] },
  { label: 'Opportunities', capabilities: ['opportunity.create', 'opportunity.update'] },
  { label: 'Tasks', capabilities: ['follow_up.manage'] },
  {
    label: 'Work',
    capabilities: [
      'work_item.create',
      'work_item.update',
      'work_item.transition',
      'work_item.schedule',
      'work_item.record',
      'work_item.price',
    ],
  },
  {
    label: 'Locations / assets / resources',
    capabilities: ['location.create', 'asset.create', 'resource.create', 'resource.update'],
  },
  { label: 'Communications', capabilities: ['call.place', 'message.send'] },
  { label: 'Marketing', capabilities: ['marketing.read', 'marketing.manage'] },
  {
    label: 'Support',
    capabilities: ['support.read', 'support.case.create', 'support.case.update', 'support.case.assign', 'support.case.resolve', 'support.configure'],
  },
  { label: 'Finance', capabilities: ['price.manage', 'invoice.issue', 'payment.record'] },
  {
    label: 'Automation & AI',
    capabilities: ['automation.manage', 'assistant.ask', 'configuration.propose'],
  },
  { label: 'Reporting', capabilities: ['report.read', 'report.manage'] },
  { label: 'Documents / data', capabilities: ['document.create', 'field.manage'] },
  { label: 'People & access', capabilities: ['role.manage'] },
  {
    label: 'Business administration',
    // billing.manage sits here, not in Finance — it is the GOLD → business plane (starting or
    // managing this business's own subscription with GOLD), the opposite money direction from
    // price.manage/invoice.issue/payment.record above, and never presented as their sibling
    // (the same separation the Settings hub draws between tenant identity and product state).
    capabilities: ['organization.manage', 'integration.manage', 'feature.manage', 'billing.manage', 'secret.manage'],
  },
];

/** Every capability named exactly once, in `CAPABILITIES` order within its group — asserted by `capability-selector.test.ts`. */
export const CAPABILITY_GROUPS = GROUPS;

/**
 * A grouped checkbox list for one role's capabilities: the one checkbox implementation, used by
 * the role editor. Controlled when `value` is given, otherwise it keeps its own selection from
 * `selected`. `query` narrows what is shown; a ticked permission that is filtered out is still
 * submitted. Sensitive permissions are marked in words.
 */
export function CapabilitySelector({
  selected,
  value,
  onChange,
  query = '',
  grantable,
  idPrefix = 'capability',
}: {
  /** Which capabilities start checked when uncontrolled. */
  selected?: ReadonlySet<Capability>;
  value?: ReadonlySet<Capability>;
  onChange?: (next: ReadonlySet<Capability>) => void;
  query?: string;
  /** What the person editing holds. A permission outside it can be removed but not given. Absent: no limit. */
  grantable?: ReadonlySet<Capability>;
  idPrefix?: string;
}) {
  const [own, setOwn] = useState<ReadonlySet<Capability>>(() => new Set(selected));
  const current = value ?? own;
  const set = (next: ReadonlySet<Capability>) => { if (!value) setOwn(next); onChange?.(next); };
  const toggle = (capability: Capability, on: boolean) => {
    const next = new Set(current);
    if (on) next.add(capability); else next.delete(capability);
    set(next);
  };
  const mayGive = (capability: Capability) => !grantable || grantable.has(capability);
  const needle = query.trim().toLowerCase();
  const shown = GROUPS
    .map((group) => ({
      ...group,
      visible: !needle || group.label.toLowerCase().includes(needle)
        ? group.capabilities
        : group.capabilities.filter((capability) => CAPABILITY_LABELS[capability].toLowerCase().includes(needle)),
    }))
    .filter((group) => group.visible.length > 0);
  const visible = new Set(shown.flatMap((group) => group.visible));

  return (
    <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
      {[...current].filter((capability) => !visible.has(capability)).map((capability) => (
        <input key={capability} type="hidden" name="capabilities" value={capability} />
      ))}
      {shown.length === 0 ? <Hint role="status">No permission matches “{query.trim()}”.</Hint> : null}
      {shown.map((group) => {
        const held = group.capabilities.filter((capability) => current.has(capability)).length;
        const all = group.capabilities.every((capability) => current.has(capability) || !mayGive(capability));
        const none = group.capabilities.every((capability) => !current.has(capability) && !mayGive(capability));
        return (
          <fieldset key={group.label} className="flex min-w-0 flex-col gap-2">
            <legend className="flex w-full items-center justify-between gap-3 border-b border-border pb-1.5 text-sm font-medium">
              <span>{group.label} <span className="font-normal tabular-nums text-muted">{held} of {group.capabilities.length}</span></span>
              <Button
                type="button"
                tone="text"
                size="tiny"
                aria-label={`${all ? 'Clear' : 'Select all'} ${group.label}`}
                disabled={none}
                onClick={() => {
                  const next = new Set(current);
                  for (const capability of group.capabilities) { if (all) next.delete(capability); else if (mayGive(capability)) next.add(capability); }
                  set(next);
                }}
              >
                {all ? 'Clear' : 'Select all'}
              </Button>
            </legend>
            {group.visible.map((capability) => {
              const id = `${idPrefix}-${capability}`;
              return (
                <label key={capability} htmlFor={id} className="flex items-start gap-2 text-sm">
                  <input
                    id={id}
                    type="checkbox"
                    name="capabilities"
                    value={capability}
                    className="mt-0.5"
                    checked={current.has(capability)}
                    disabled={!current.has(capability) && !mayGive(capability)}
                    onChange={(event) => toggle(capability, event.target.checked)}
                  />
                  <span className="min-w-0">
                    {CAPABILITY_LABELS[capability]}
                    {SENSITIVE_CAPABILITIES.has(capability) ? <Badge className="ml-2 align-middle">Sensitive</Badge> : null}
                  </span>
                </label>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}

// Every capability appears in exactly one group — checked here rather than only by the test, so
// a build with a mistake in the table above fails loudly rather than shipping a checkbox that
// silently cannot be granted.
const grouped = new Set(GROUPS.flatMap((g) => g.capabilities));
for (const capability of CAPABILITIES) {
  if (!grouped.has(capability)) {
    throw new Error(`CapabilitySelector has no group for "${capability}".`);
  }
}
if (grouped.size !== CAPABILITIES.length) {
  throw new Error('CapabilitySelector groups a key that is no longer declared.');
}
