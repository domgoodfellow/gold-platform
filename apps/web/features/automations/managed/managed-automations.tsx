'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/controls/button';
import { DividedList, SectionHeader } from '@/components/surfaces/section';
import {
  PageDrawer,
  PageDrawerContent,
  PageDrawerHeader,
  PageDrawerTitle,
  PageDrawerTrigger,
} from '@/components/panels/page-drawer';
import type { ManagedAutomation } from '@/lib/domain/automation/managed';

/**
 * GildOps' own automated work for this business, beside the business's workflows and never mixed
 * into them. Each entry is read-only here: it names where its settings and records already live.
 */
export function ManagedAutomations({
  organizationId,
  entries,
}: {
  organizationId: string;
  entries: ManagedAutomation[];
}) {
  if (!entries.length) return null;
  const href = (path: string) => `/organizations/${organizationId}/${path}`;
  return (
    <section aria-labelledby="managed-automations">
      <SectionHeader id="managed-automations" title="Managed by GildOps" />
      <DividedList className="mt-2 border-y border-border">
        {entries.map((entry) => (
          <li key={entry.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{entry.name}</p>
              <p className="text-xs text-subtle">
                {entry.runs} · {entry.owner}
              </p>
            </div>
            <ManagedAutomationDrawer entry={entry} href={href} />
          </li>
        ))}
      </DividedList>
    </section>
  );
}

function ManagedAutomationDrawer({
  entry,
  href,
}: {
  entry: ManagedAutomation;
  href: (path: string) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <PageDrawer open={open} onOpenChange={setOpen}>
      <PageDrawerTrigger asChild>
        <Button type="button" size="small" tone="secondary" aria-label={`Inspect ${entry.name}`}>
          Inspect
        </Button>
      </PageDrawerTrigger>
      <PageDrawerContent>
        <PageDrawerHeader>
          <PageDrawerTitle>{entry.name}</PageDrawerTitle>
        </PageDrawerHeader>
        <dl className="flex flex-col gap-4 text-sm">
          <div>
            <dt className="text-xs text-subtle">What it does</dt>
            <dd className="mt-1">{entry.purpose}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">When it runs</dt>
            <dd className="mt-1">{entry.runs}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Owned by</dt>
            <dd className="mt-1">{entry.owner}</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Editing</dt>
            <dd className="mt-1">Run by GildOps. It is not a workflow and cannot be edited here.</dd>
          </div>
          <div>
            <dt className="text-xs text-subtle">Settings</dt>
            <dd className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {entry.controls.map((control) => (
                <Link key={control.path} href={href(control.path)} className="text-accent-text underline-offset-4 hover:underline">
                  {control.label}
                </Link>
              ))}
            </dd>
          </div>
          {entry.records ? (
            <div>
              <dt className="text-xs text-subtle">Records</dt>
              <dd className="mt-1">
                <Link href={href(entry.records.path)} className="text-accent-text underline-offset-4 hover:underline">
                  {entry.records.label}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      </PageDrawerContent>
    </PageDrawer>
  );
}
